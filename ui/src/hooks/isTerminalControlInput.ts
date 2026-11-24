/** Ignore terminal reports that Ink may pass to useInput after stripping ESC. */
export function isTerminalControlInput(input: string): boolean {
  return /^(?:\u001B)?(?:\[<\d+;\d+;\d+[Mm]|\[\d+;\d+R|\][^\u0007]*(?:\u0007|\u001B\\)|O[ -~])$/.test(input);
}
