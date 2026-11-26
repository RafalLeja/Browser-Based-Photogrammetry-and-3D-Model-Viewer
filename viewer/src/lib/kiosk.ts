// The kiosk's attract loop as plain data, tested in Node.

export type Phase = { kind: 'turn' } | { kind: 'note'; index: number };

/** What the attract loop shows after `phase` on an object with `notes` notes: the next note or the next object. */
export function nextPhase(phase: Phase, notes: number): Phase | 'next-object' {
  if (phase.kind === 'turn') return notes > 0 ? { kind: 'note', index: 0 } : 'next-object';
  return phase.index + 1 < notes ? { kind: 'note', index: phase.index + 1 } : 'next-object';
}
