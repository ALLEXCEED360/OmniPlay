'use client';

import { useEffect, useState } from 'react';

/**
 * Copies the page's own address. The label confirms for a moment and then
 * returns, because a button that stays on "Copied" for ever has stopped
 * telling the truth the second time it is pressed.
 */
export function ShareLink({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(window.location.href)
          .then(() => setCopied(true))
          .catch(() => {
            // Clipboard blocked: the address bar is right there.
          });
      }}
      className={`btn-ghost btn-sm ${className}`}
    >
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}
