import {ipcMain} from 'electron';
import {addContact, listContacts, removeContact, updateContact} from '../config/contact-book';

function registerContactsIpc() {
  ipcMain.handle('contacts-list', _event => listContacts());
  ipcMain.handle('contacts-add', (_event, name: string, address: string) =>
    addContact(name, address)
  );
  ipcMain.handle(
    'contacts-update',
    (_event, id: string, updates: {name?: string; address?: string}) => updateContact(id, updates)
  );
  ipcMain.handle('contacts-remove', (_event, id: string) => removeContact(id));
}

export {registerContactsIpc};
