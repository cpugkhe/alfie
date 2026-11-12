export interface ConfirmationOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function createConfirmation(options: ConfirmationOptions, repo: string | null) {
  let resolve: (confirmed: boolean) => void = () => {};
  const result = new Promise<boolean>((settle) => { resolve = settle; });
  return { ...options, confirmLabel: options.confirmLabel ?? 'Confirm', repo, result, resolve };
}

export type Confirmation = ReturnType<typeof createConfirmation>;
