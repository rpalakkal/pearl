export interface SendDraft {
  amount: string;
  address: string;
  feeLevel: 'fast' | 'medium' | 'slow';
}

// Survives the unlock round-trip (sessionStorage: cleared when the app
// closes, never written to disk).
const SEND_DRAFT_KEY = 'pearl:send-draft';

export function saveSendDraft(draft: SendDraft): void {
  try {
    sessionStorage.setItem(SEND_DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    console.warn('Failed to save send draft:', error);
  }
}

export function takeSendDraft(): SendDraft | null {
  try {
    const raw = sessionStorage.getItem(SEND_DRAFT_KEY);
    sessionStorage.removeItem(SEND_DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const draft = JSON.parse(raw) as Partial<SendDraft>;
    if (typeof draft.amount !== 'string' || typeof draft.address !== 'string') {
      return null;
    }
    return {
      amount: draft.amount,
      address: draft.address,
      feeLevel:
        draft.feeLevel === 'medium' || draft.feeLevel === 'slow' ? draft.feeLevel : 'fast',
    };
  } catch {
    return null;
  }
}
