import {ipcMain} from 'electron';
import {ManagerService} from '../services/manager-service';
import {getRecipientSendStatus} from '../services/send-history-service';
import type {AppNetwork} from '../../types/app-bridge';

function registerSendHistoryIpc(ms: ManagerService) {
  ipcMain.handle(
    'send-history-recipient-status',
    (_event, address: string, network: AppNetwork) =>
      getRecipientSendStatus(address, network, ms.getWalletServiceIfRunning())
  );
}

export {registerSendHistoryIpc};
