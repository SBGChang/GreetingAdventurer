// Only an explicitly unavailable production port is converted to a typed rejection.
// Unexpected implementation errors remain errors and retain their original stack.
export class UnavailableCapabilityError extends Error {
  constructor(readonly capability: string) {
    super(`Runtime capability unavailable: ${capability}`);
    this.name = 'UnavailableCapabilityError';
  }
}
