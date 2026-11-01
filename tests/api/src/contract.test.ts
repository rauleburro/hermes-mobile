// Contract tests for @hermes-mobile/api against Hermes Agent v0.22.5.
// Runtime checks run under vitest; the type-level checks (`expectTypeOf`,
// `@ts-expect-error`) are enforced by `pnpm typecheck`.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  TERMINAL_EVENTS,
  TERMINAL_STATUSES,
  isTerminalStatus,
  type ApprovalChoice,
  type ApprovalRequest,
  type ApprovalResponse,
  type HermesError,
  type RunEvent,
  type RunStatus,
} from '@hermes-mobile/api';

type EventOf<E extends RunEvent['event']> = Extract<RunEvent, { event: E }>;

describe('run statuses', () => {
  it('includes every status Hermes 0.22.5 reports, unknown included', () => {
    expectTypeOf<RunStatus>().toEqualTypeOf<
      | 'queued'
      | 'running'
      | 'waiting_for_approval'
      | 'stopping'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'interrupted'
      | 'unknown'
    >();
  });

  it('treats completed, failed, cancelled and interrupted as terminal', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(['cancelled', 'completed', 'failed', 'interrupted']);
    for (const status of ['completed', 'failed', 'cancelled', 'interrupted']) {
      expect(isTerminalStatus(status)).toBe(true);
    }
  });

  it('does not treat unknown (or any live status) as terminal', () => {
    for (const status of ['unknown', 'queued', 'running', 'waiting_for_approval', 'stopping', 'nonsense']) {
      expect(isTerminalStatus(status)).toBe(false);
    }
  });
});

describe('run events', () => {
  it('keeps the terminal events', () => {
    expect([...TERMINAL_EVENTS].sort()).toEqual(['run.cancelled', 'run.completed', 'run.failed', 'run.interrupted']);
  });

  it('covers the events Hermes emits on /v1/runs', () => {
    expectTypeOf<RunEvent['event']>().toEqualTypeOf<
      | 'run.queued'
      | 'run.stopping'
      | 'message.delta'
      | 'message.interim'
      | 'tool.started'
      | 'tool.completed'
      | 'reasoning.available'
      | 'subagent.start'
      | 'subagent.complete'
      | 'approval.request'
      | 'approval.responded'
      | 'approval.settled'
      | 'clarify.request'
      | 'clarify.settled'
      | 'run.steered'
      | 'replay.truncated'
      | 'run.completed'
      | 'run.failed'
      | 'run.cancelled'
      | 'run.interrupted'
    >();
  });

  it('does not model events that never arrive on /v1/runs', () => {
    // @ts-expect-error run.started is only emitted on another endpoint
    const started: RunEvent = { event: 'run.started', run_id: 'r', timestamp: 0 };
    // @ts-expect-error a failed tool arrives as tool.completed with error: true
    const failed: RunEvent = { event: 'tool.failed', run_id: 'r', timestamp: 0, tool: 't', duration: 1, error: true };
    expect([started, failed]).toHaveLength(2);
  });

  it('exposes the approval prompt id and execution generation', () => {
    expectTypeOf<EventOf<'approval.request'>['prompt_id']>().toEqualTypeOf<string>();
    expectTypeOf<EventOf<'approval.request'>['execution_generation']>().toEqualTypeOf<number>();
    expectTypeOf<EventOf<'approval.request'>['choices']>().toEqualTypeOf<ApprovalChoice[]>();
    // 0.22.5 always sends prompt_id; the legacy request_id is not modelled.
    expectTypeOf<'request_id' extends keyof EventOf<'approval.request'> ? true : false>().toEqualTypeOf<false>();
  });

  it('reports tool failures on tool.completed', () => {
    expectTypeOf<EventOf<'tool.completed'>['error']>().toEqualTypeOf<boolean>();
    expectTypeOf<EventOf<'tool.completed'>['tool_call_id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<EventOf<'tool.started'>['tool_call_id']>().toEqualTypeOf<string | undefined>();
  });

  it('carries the clarify prompt fields', () => {
    expectTypeOf<EventOf<'clarify.request'>>().toMatchTypeOf<{
      prompt_id: string;
      execution_generation: number;
      question: string;
      choices: string[];
      multi_select: boolean;
    }>();
  });

  it('carries the terminal fields on every terminal event', () => {
    type Terminal = EventOf<'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted'>;
    expectTypeOf<Terminal['output']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Terminal['error']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Terminal['runtime']>().toEqualTypeOf<
      | {
          provider?: string;
          model?: string;
          route_source?: string;
          requested?: { provider?: string; model?: string };
        }
      | undefined
    >();
    expectTypeOf<Terminal['partial']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Terminal['turn_exit_reason']>().toEqualTypeOf<string | undefined>();
  });

  it('names the usage counters exactly as Hermes sends them (api_server_runs.py _USAGE_FIELDS)', () => {
    type Terminal = EventOf<'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted'>;
    expectTypeOf<NonNullable<Terminal['usage']>>().toEqualTypeOf<{
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      cache_read_tokens?: number;
      cache_write_tokens?: number;
    }>();
  });

  it('counts resolved approvals on approval.responded (api_server_runs.py approval handler)', () => {
    expectTypeOf<EventOf<'approval.responded'>['resolved']>().toEqualTypeOf<number>();
  });

  it('identifies the settled prompt on approval.settled and clarify.settled (session_pending_controls.py)', () => {
    expectTypeOf<EventOf<'approval.settled'>['prompt_id']>().toEqualTypeOf<string>();
    expectTypeOf<EventOf<'approval.settled'>['execution_generation']>().toEqualTypeOf<number>();
    expectTypeOf<EventOf<'clarify.settled'>['prompt_id']>().toEqualTypeOf<string>();
    expectTypeOf<EventOf<'clarify.settled'>['execution_generation']>().toEqualTypeOf<number>();
  });

  it('carries the undelivered steer and the failure reason on terminal events', () => {
    type Terminal = EventOf<'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted'>;
    expectTypeOf<Terminal['pending_steer']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Terminal['reason']>().toEqualTypeOf<string | undefined>();
  });

  it('may omit subagent_id on subagent events (forwarded only when set)', () => {
    expectTypeOf<EventOf<'subagent.start' | 'subagent.complete'>['subagent_id']>().toEqualTypeOf<string | undefined>();
  });

  it('reports the requested seq on replay.truncated', () => {
    expectTypeOf<EventOf<'replay.truncated'>['oldest_retained_seq']>().toEqualTypeOf<number>();
    expectTypeOf<EventOf<'replay.truncated'>['requested_seq']>().toEqualTypeOf<number | undefined>();
  });
});

describe('approval request body', () => {
  it('requires request_id, execution_generation and choice', () => {
    const ok: ApprovalRequest = { request_id: 'p1', execution_generation: 0, choice: 'once' };
    // @ts-expect-error execution_generation is required by Hermes 0.22.5
    const noGeneration: ApprovalRequest = { request_id: 'p1', choice: 'once' };
    // @ts-expect-error request_id (the event's prompt_id) is required
    const noId: ApprovalRequest = { execution_generation: 1, choice: 'deny' };
    // @ts-expect-error only once|session|always|deny are valid
    const badChoice: ApprovalRequest = { request_id: 'p1', execution_generation: 1, choice: 'yes' };
    expect([ok, noGeneration, noId, badChoice]).toHaveLength(4);
  });

  it('models the approval response', () => {
    expectTypeOf<ApprovalResponse['status']>().toEqualTypeOf<'resolved' | 'already_resolved'>();
    expectTypeOf<ApprovalResponse['prompt_id']>().toEqualTypeOf<string>();
  });
});

describe('Hermes error envelope', () => {
  it('nests message and type under error, with optional param and code', () => {
    const minimal: HermesError = { error: { message: 'bad', type: 'invalid_request_error' } };
    const full: HermesError = {
      error: { message: 'stale', type: 'invalid_request_error', param: 'execution_generation', code: 'stale_generation' },
    };
    expect([minimal, full]).toHaveLength(2);
  });
});
