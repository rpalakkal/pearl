import {useReducer} from 'react';

interface HardwareSendFormState {
  amount: string;
  address: string;
  error: string | null;
  success: string | null;
  lastFee: string | null;
}

type HardwareSendFormAction =
  | {type: 'edit-address'; value: string}
  | {type: 'edit-amount'; value: string}
  | {type: 'error'; value: string}
  | {type: 'last-fee'; value: string}
  | {type: 'reset'; clearFields: boolean}
  | {type: 'success'; value: string};

const initialSendFormState: HardwareSendFormState = {
  address: '',
  amount: '',
  error: null,
  lastFee: null,
  success: null,
};

function hardwareSendFormReducer(
  state: HardwareSendFormState,
  action: HardwareSendFormAction
): HardwareSendFormState {
  switch (action.type) {
    case 'edit-address':
      return {...state, address: action.value, error: null, success: null};
    case 'edit-amount':
      return {...state, amount: action.value, error: null, success: null};
    case 'error':
      return {...state, error: action.value};
    case 'last-fee':
      return {...state, lastFee: action.value};
    case 'reset':
      return {
        ...state,
        address: action.clearFields ? '' : state.address,
        amount: action.clearFields ? '' : state.amount,
        error: null,
        lastFee: null,
        success: null,
      };
    case 'success':
      return {...state, error: null, success: action.value};
  }
}

export function useHardwareSendFormState() {
  const [state, dispatch] = useReducer(hardwareSendFormReducer, initialSendFormState);

  return {
    lastSendFee: state.lastFee,
    resetSendState: (clearFields: boolean) => {
      dispatch({type: 'reset', clearFields});
    },
    sendAddress: state.address,
    sendAmount: state.amount,
    sendError: state.error,
    sendSuccess: state.success,
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
    setSendSuccess: (value: string) => {
      dispatch({type: 'success', value});
    },
  };
}
