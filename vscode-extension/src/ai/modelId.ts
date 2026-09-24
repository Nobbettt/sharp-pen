/** Model IDs are the only user-controlled argv values accepted by the CLIs. */
export const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export function isModelId(value: string): boolean {
  return modelIdPattern.test(value);
}
