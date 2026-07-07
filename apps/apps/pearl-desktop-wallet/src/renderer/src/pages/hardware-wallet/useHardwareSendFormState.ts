import {useReducer} from 'react';
import type {
  HardwareSendReviewSnapshot,
  HardwareSendSignedSnapshot,
} from './sendWorkflow.ts';
import type {KnownAddress} from '../../components/contact-book/useAddressBook.ts';
import type {SendGateDecision} from '../../lib/sendGate.ts';
import type {RecipientSendStatus} from '../../../../types/app-bridge.ts';

// Everything the Review step knows about the recipient: contact/own-address
// recognition, prior send history, and the large-send gate decision.
export interface RecipientContext {
  known: KnownAddress | null;
  history: RecipientSendStatus | null;
  gate: SendGateDecision;
}

export type HardwareSendStage =
  | {step: 'edit'}
  | {step: 'preparing-review'}
  | {step: 'review'; review: HardwareSendReviewSnapshot; recipient: RecipientContext}
  | {step: 'signing'; review: HardwareSendReviewSnapshot; recipient: RecipientContext}
  | {step: 'signed'; snapshot: HardwareSendSignedSnapshot; recipient: RecipientContext}
  | {step: 'broadcasting'; snapshot: HardwareSendSignedSnapshot; recipient: RecipientContext};

interface HardwareSendFormState {
  amount: string;
  address: string;
  error: string | null;
  success: string | null;
  lastFee: string | null;
  stage: HardwareSendStage;
}

export type HardwareSendFormAction =
  | {type: 'edit-address'; value: string}
  | {type: 'edit-amount'; value: string}
  | {type: 'error'; value: string}
  | {type: 'last-fee'; value: string}
  | {type: 'reset'; clearFields: boolean}
  | {type: 'review-preparing'}
  | {type: 'review-prepared'; review: HardwareSendReviewSnapshot; recipient: RecipientContext}
  | {type: 'sign-started'}
  | {type: 'sign-completed'; snapshot: HardwareSendSignedSnapshot}
  | {type: 'sign-failed'; message: string}
  | {type: 'broadcast-started'}
  | {type: 'broadcast-failed'; message: string}
  | {type: 'broadcast-succeeded'; txid: string}
  | {type: 'stage-cancelled'}
  | {type: 'stage-invalidated'; message: string};

export const initialHardwareSendFormState: HardwareSendFormState = {
  address: '',
  amount: '',
  error: null,
  lastFee: null,
  success: null,
  stage: {step: 'edit'},
};

export function hardwareSendFormReducer(
  state: HardwareSendFormState,
  action: HardwareSendFormAction
): HardwareSendFormState {
  switch (action.type) {
    case 'edit-address':
      // Field edits are only legal while composing; later stages present the
      // frozen review snapshot.
      if (state.stage.step !== 'edit') {
        return state;
      }
      return {...state, address: action.value, error: null, success: null};
    case 'edit-amount':
      if (state.stage.step !== 'edit') {
        return state;
      }
      return {...state, amount: action.value, error: null, success: null};
    case 'error':
      return {...state, error: action.value};
    case 'last-fee':
      return {...state, lastFee: action.value};
    case 'reset':
      // Fired on account/network switches too, which must abandon any staged
      // send (including a signed-but-unbroadcast transaction).
      return {
        ...state,
        address: action.clearFields ? '' : state.address,
        amount: action.clearFields ? '' : state.amount,
        error: null,
        lastFee: null,
        success: null,
        stage: {step: 'edit'},
      };
    case 'review-preparing':
      if (state.stage.step !== 'edit') {
        return state;
      }
      return {...state, error: null, success: null, stage: {step: 'preparing-review'}};
    case 'review-prepared':
      if (state.stage.step !== 'preparing-review') {
        return state;
      }
      return {
        ...state,
        stage: {step: 'review', review: action.review, recipient: action.recipient},
      };
    case 'sign-started':
      if (state.stage.step !== 'review') {
        return state;
      }
      return {
        ...state,
        error: null,
        stage: {step: 'signing', review: state.stage.review, recipient: state.stage.recipient},
      };
    case 'sign-completed':
      if (state.stage.step !== 'signing') {
        return state;
      }
      return {
        ...state,
        stage: {step: 'signed', snapshot: action.snapshot, recipient: state.stage.recipient},
      };
    case 'sign-failed':
      // Device rejection/unplug returns to Review; the snapshot is unchanged
      // and the next sign attempt re-validates anyway.
      if (state.stage.step !== 'signing') {
        return state;
      }
      return {
        ...state,
        error: action.message,
        stage: {step: 'review', review: state.stage.review, recipient: state.stage.recipient},
      };
    case 'broadcast-started':
      if (state.stage.step !== 'signed') {
        return state;
      }
      return {
        ...state,
        error: null,
        stage: {
          step: 'broadcasting',
          snapshot: state.stage.snapshot,
          recipient: state.stage.recipient,
        },
      };
    case 'broadcast-failed':
      // Broadcast is retryable: stay on the signed transaction.
      if (state.stage.step !== 'broadcasting') {
        return state;
      }
      return {
        ...state,
        error: action.message,
        stage: {step: 'signed', snapshot: state.stage.snapshot, recipient: state.stage.recipient},
      };
    case 'broadcast-succeeded':
      return {
        ...state,
        address: '',
        amount: '',
        error: null,
        success: action.txid,
        stage: {step: 'edit'},
      };
    case 'stage-cancelled':
      return {...state, error: null, stage: {step: 'edit'}};
    case 'stage-invalidated':
      return {...state, error: action.message, stage: {step: 'edit'}};
  }
}

export function useHardwareSendFormState() {
  const [state, dispatch] = useReducer(hardwareSendFormReducer, initialHardwareSendFormState);

  return {
    lastSendFee: state.lastFee,
    resetSendState: (clearFields: boolean) => {
      dispatch({type: 'reset', clearFields});
    },
    sendAddress: state.address,
    sendAmount: state.amount,
    sendError: state.error,
    sendStage: state.stage,
    sendSuccess: state.success,
    dispatchSendStage: dispatch,
    setLastSendFee: (value: string) => {
      dispatch({type: 'last-fee', value});
    },
    setSendAddress: (value: string) => {
      dispatch({type: 'edit-address', value});
    },
    setSendAmount: (value: string) => {
      dispatch({type: 'edit-amount', value});
    },
    setSendError: (value: string) => {
      dispatch({type: 'error', value});
    },
  };
}
