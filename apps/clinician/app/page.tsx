import { FRAMING } from '@ledger/shared';

export default function Home() {
  return (
    <main>
      <h1>Ledger — clinician view</h1>
      <p>
        <strong>Placeholder.</strong> Milestone 1 ships the client app, the API, and the shared logic. This app will show, for each
        linked client and only the layers they have consented to share: the calibration record by rule (Recharts), the furnace
        profile (never-misses, abandonment rate, reinterpretation rate), body survivals with and without kit, and the
        <code> safe_to_test </code> gate per rule.
      </p>
      <p>{FRAMING.tagline}</p>
    </main>
  );
}
