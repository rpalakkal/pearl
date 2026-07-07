import {ArrowLeft} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {ContactBookPanel} from '../components/contact-book/ContactBookPanel';

// Standalone contact management page (/contacts) — the same panel the send
// flows use as a picker, hosted without selection semantics.
export default function ContactsPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full w-full flex-col bg-transparent">
      <div className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-2 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft className="h-5 w-5 text-gray-700" />
        </button>
        <h1 className="text-2xl font-semibold text-gray-900">Contacts</h1>
      </div>

      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-4 py-6">
        <div className="flex h-fit min-h-0 w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
          <ContactBookPanel />
        </div>
      </div>
    </div>
  );
}
