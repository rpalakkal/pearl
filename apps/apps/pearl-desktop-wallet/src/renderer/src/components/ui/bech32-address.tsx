import {cn} from '@/lib/utils';

// Bech32 data characters never include '1', so the last '1' is always the
// HRP separator. The char right after it is the witness version; the last
// six chars are the checksum. Everything between is the encoded program,
// which is identical for the same key across HRPs (prl1p... vs bc1p...).
function splitBech32(address: string): {prefix: string; payload: string; checksum: string} | null {
  const separator = address.lastIndexOf('1');
  const prefixEnd = separator + 2; // include the witness-version char
  if (separator < 1 || address.length < prefixEnd + 6 + 1) {
    return null;
  }
  return {
    prefix: address.slice(0, prefixEnd),
    payload: address.slice(prefixEnd, -6),
    checksum: address.slice(-6),
  };
}

// Renders a bech32 address with the network prefix and checksum de-emphasized
// in distinct colors, so the shared middle section (the key payload) is easy
// to compare between two encodings of the same key (e.g. the app's prl1p...
// address vs the bc1p... address a hardware device displays).
export function Bech32Address({address, className}: {address: string; className?: string}) {
  const parts = splitBech32(address);

  if (!parts) {
    return <span className={cn('break-all font-mono', className)}>{address}</span>;
  }

  return (
    <span className={cn('break-all font-mono', className)}>
      <span className="text-sky-600">{parts.prefix}</span>
      {parts.payload}
      <span className="text-amber-600">{parts.checksum}</span>
    </span>
  );
}
