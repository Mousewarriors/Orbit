import { useCallback, useState } from 'react';
import { acceleratorFromEvent, humanizeAccelerator } from '@orbit/shortcuts';

/**
 * A button that records the next key chord the user presses and reports it as an
 * accelerator string (e.g. "Control+Shift+KeyK"). Lone modifier presses are
 * ignored so the user can hold modifiers before pressing the real key.
 */
export function ShortcutRecorder({
  value,
  onRecorded,
}: {
  value: string;
  onRecorded: (accelerator: string) => void;
}): JSX.Element {
  const [recording, setRecording] = useState(false);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent({
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        code: e.code,
      });
      if (accelerator) {
        setRecording(false);
        onRecorded(accelerator);
      }
    },
    [recording, onRecorded],
  );

  return (
    <button
      type="button"
      className={`settings-recorder${recording ? ' is-recording' : ''}`}
      onClick={() => setRecording((r) => !r)}
      onKeyDown={onKeyDown}
      onBlur={() => setRecording(false)}
    >
      {recording ? 'Press a shortcut…  (Esc to cancel)' : humanizeAccelerator(value) || 'Set shortcut'}
    </button>
  );
}
