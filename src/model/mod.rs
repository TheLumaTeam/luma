pub mod anthropic;
pub mod gemini;
pub mod openai;

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use futures_util::{StreamExt, stream::BoxStream};
use std::sync::{Arc, RwLock};

use crate::{config::ModelConfig, context::Message};

pub use openai::OpenAICompatibleModel;

pub type ModelStream = BoxStream<'static, Result<String>>;

/// A model handle whose implementation can be replaced while the core stays alive.
#[derive(Clone)]
pub struct DynamicModel {
    current: Arc<RwLock<Arc<dyn Model>>>,
}

impl DynamicModel {
    pub fn new(config: &ModelConfig) -> Self {
        Self {
            current: Arc::new(RwLock::new(Arc::from(create_model(config)))),
        }
    }

    pub async fn replace(&self, config: &ModelConfig) {
        *self
            .current
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Arc::from(create_model(config));
    }
}

#[async_trait]
impl Model for DynamicModel {
    async fn stream(&self, request: CompletionRequest) -> Result<ModelStream> {
        // Clone the active implementation before awaiting so switching models
        // never waits for an in-flight response stream to finish.
        let model = self
            .current
            .read()
            .map_err(|_| anyhow!("active model lock is poisoned"))?
            .clone();
        const MAX_ATTEMPTS: usize = 3;
        let messages = request.messages;
        let (stream, attempt) = open_with_retries(model.clone(), messages.clone(), 1).await?;

        // A failed stream can be restarted only before any text has escaped
        // to the caller. Once output is emitted, retrying would duplicate it.
        let output = futures_util::stream::unfold(
            (stream, model, messages, attempt, false),
            |(mut stream, model, messages, mut attempt, emitted)| async move {
                loop {
                    match stream.next().await {
                        Some(Ok(chunk)) => {
                            return Some((Ok(chunk), (stream, model, messages, attempt, true)));
                        }
                        Some(Err(error))
                            if !emitted
                                && attempt < MAX_ATTEMPTS
                                && is_retryable_provider_error(&error.to_string()) =>
                        {
                            match open_with_retries(model.clone(), messages.clone(), attempt + 1)
                                .await
                            {
                                Ok((retry_stream, retry_attempt)) => {
                                    stream = retry_stream;
                                    attempt = retry_attempt;
                                }
                                Err(retry_error) => {
                                    return Some((
                                        Err(retry_error),
                                        (stream, model, messages, MAX_ATTEMPTS, true),
                                    ));
                                }
                            }
                        }
                        Some(Err(error)) => {
                            return Some((Err(error), (stream, model, messages, attempt, true)));
                        }
                        None => return None,
                    }
                }
            },
        );
        Ok(Box::pin(output))
    }

    fn usage(&self) -> Option<Usage> {
        self.current.read().ok()?.usage()
    }
}

async fn open_with_retries(
    model: Arc<dyn Model>,
    messages: Vec<Message>,
    mut attempt: usize,
) -> Result<(ModelStream, usize)> {
    const MAX_ATTEMPTS: usize = 3;
    loop {
        match model
            .stream(CompletionRequest {
                messages: messages.clone(),
            })
            .await
        {
            Ok(stream) => return Ok((stream, attempt)),
            Err(error)
                if attempt < MAX_ATTEMPTS && is_retryable_provider_error(&error.to_string()) =>
            {
                retry_provider(attempt, &error).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

async fn retry_provider(attempt: usize, error: &anyhow::Error) {
    let delay = std::time::Duration::from_millis(400 * (1 << (attempt - 1)));
    tracing::warn!(
        attempt,
        max_attempts = 3,
        delay_ms = delay.as_millis(),
        error = %error,
        "Transient model provider failure; retrying"
    );
    tokio::time::sleep(delay).await;
}

fn is_retryable_provider_error(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    [
        "http 408",
        "http 425",
        "http 429",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
        "failed to connect",
        "error sending request",
        "connection reset",
        "connection refused",
        "connection closed",
        "timed out",
        "timeout",
        "temporarily unavailable",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

pub struct CompletionRequest {
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Default)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

#[async_trait]
pub trait Model: Send + Sync {
    async fn stream(&self, request: CompletionRequest) -> Result<ModelStream>;

    fn usage(&self) -> Option<Usage> {
        None
    }
}

pub fn create_model(config: &ModelConfig) -> Box<dyn Model> {
    match config.provider.as_str() {
        "anthropic" | "Anthropic" => Box::new(anthropic::AnthropicModel::new(config.clone())),

        "gemini" | "Google Gemini" => Box::new(gemini::GeminiModel::new(config.clone())),

        _ => Box::new(OpenAICompatibleModel::new(
            config.endpoint.clone(),
            config.name.clone(),
            config.api_key.clone(),
        )),
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;
    use futures_util::stream;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct RetryModel {
        attempts: AtomicUsize,
    }

    #[async_trait]
    impl Model for RetryModel {
        async fn stream(&self, _request: CompletionRequest) -> Result<ModelStream> {
            if self.attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                return Ok(Box::pin(stream::iter([Err(anyhow!("connection reset"))])));
            }
            Ok(Box::pin(stream::iter([Ok("recovered".to_string())])))
        }
    }

    #[tokio::test]
    async fn retries_a_transient_stream_failure_before_emitting_output() {
        let provider = Arc::new(RetryModel {
            attempts: AtomicUsize::new(0),
        });
        let model = DynamicModel {
            current: Arc::new(RwLock::new(provider.clone())),
        };

        let mut output = model
            .stream(CompletionRequest { messages: vec![] })
            .await
            .unwrap();
        assert_eq!(output.next().await.unwrap().unwrap(), "recovered");
        assert_eq!(provider.attempts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn retries_transient_provider_failures() {
        for message in [
            "Model provider returned HTTP 429",
            "Model provider returned HTTP 503",
            "Failed to connect to model provider: connection reset",
            "request timed out",
        ] {
            assert!(is_retryable_provider_error(message), "{message}");
        }
    }

    #[test]
    fn does_not_retry_permanent_provider_failures() {
        for message in [
            "Model provider returned HTTP 400",
            "Model provider returned HTTP 401",
            "Model provider returned HTTP 403",
        ] {
            assert!(!is_retryable_provider_error(message), "{message}");
        }
    }
}

#[async_trait]
impl<T> Model for Box<T>
where
    T: Model + ?Sized,
{
    async fn stream(&self, request: CompletionRequest) -> Result<ModelStream> {
        (**self).stream(request).await
    }

    fn usage(&self) -> Option<Usage> {
        (**self).usage()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream;

    struct UsageModel;

    #[async_trait]
    impl Model for UsageModel {
        async fn stream(&self, _request: CompletionRequest) -> Result<ModelStream> {
            Ok(Box::pin(stream::empty()))
        }

        fn usage(&self) -> Option<Usage> {
            Some(Usage {
                prompt_tokens: 12,
                completion_tokens: 8,
                total_tokens: 20,
            })
        }
    }

    #[test]
    fn dynamic_model_forwards_usage_from_the_active_provider() {
        let model = DynamicModel {
            current: Arc::new(RwLock::new(Arc::new(UsageModel))),
        };
        let usage = model.usage().unwrap();
        assert_eq!(usage.prompt_tokens, 12);
        assert_eq!(usage.completion_tokens, 8);
        assert_eq!(usage.total_tokens, 20);
    }
}
