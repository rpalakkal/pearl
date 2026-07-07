import {ipcMain} from 'electron';
import {addContact, listContacts, removeContact, updateContact} from '../config/contact-book';
import type {ContactExtras, ContactUpdates} from '../../types/app-bridge';

function registerContactsIpc() {
  ipcMain.handle('contacts-list', _event => listContacts());
  ipcMain.handle('contacts-add', (_event, name: string, address: string, extras?: ContactExtras) =>
    addContact(name, address, extras)
  );
  ipcMain.handle('contacts-update', (_event, id: string, updates: ContactUpdates) =>
    updateContact(id, updates)
  );
  ipcMain.handle('contacts-remove', (_event, id: string) => removeContact(id));
}

export {registerContactsIpc};
