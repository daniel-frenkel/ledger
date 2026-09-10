-- The gate questions an assistant run raised.
--
-- Migration 0003 gave assistant_runs the shape proposal 02 §3 lists, which
-- records which observations the model proposed but not which gates it asked
-- about. The audit that matters most here is the negative one — the assistant
-- never clears a gate, it can only ask — and that is only checkable if what it
-- asked is on the row next to what it proposed.
--
-- Gate *keys*, not question text: 'risk' | 'dial' | 'calibrated'. The wording
-- lives in code, so the model chooses from an enum and cannot emit prose. Not
-- client content, and not derived from any: the same three keys a formulation
-- attests.
ALTER TABLE "assistant_runs"
  ADD COLUMN "gate_question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "assistant_runs"
  ADD CONSTRAINT "assistant_runs_gate_question_ids_array"
  CHECK (jsonb_typeof("gate_question_ids") = 'array');
