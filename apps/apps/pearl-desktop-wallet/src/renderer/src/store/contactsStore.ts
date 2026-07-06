import { create } from 'zustand';
import type { Contact } from '../../../types/app-bridge';

interface ContactsState {
  contacts: Contact[];
  hasLoadedContacts: boolean;
  loadContacts: () => Promise<void>;
  addContact: (name: string, address: string) => Promise<Contact>;
  updateContact: (id: string, updates: { name?: string; address?: string }) => Promise<Contact>;
  removeContact: (id: string) => Promise<void>;
}

export const useContactsStore = create<ContactsState>()(set => ({
  contacts: [],
  hasLoadedContacts: false,

  async loadContacts() {
    try {
      const contacts = await window.appBridge.contacts.list();
      set({ contacts, hasLoadedContacts: true });
    } catch (err) {
      console.error('Failed to load contacts:', err);
      set({ hasLoadedContacts: true });
    }
  },

  async addContact(name: string, address: string) {
    const contact = await window.appBridge.contacts.add(name, address);
    const contacts = await window.appBridge.contacts.list();
    set({ contacts });
    return contact;
  },

  async updateContact(id: string, updates: { name?: string; address?: string }) {
    const contact = await window.appBridge.contacts.update(id, updates);
    const contacts = await window.appBridge.contacts.list();
    set({ contacts });
    return contact;
  },

  async removeContact(id: string) {
    await window.appBridge.contacts.remove(id);
    const contacts = await window.appBridge.contacts.list();
    set({ contacts });
  },
}));
