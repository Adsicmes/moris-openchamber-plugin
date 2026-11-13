/**
 * Local mirror of the OpenChamber `GuestStatusView` wire types
 * (`@openchamber/sdk` 2.7.1, `src/status-view.ts`). Type-only: the service
 * bundle depends on Node built-ins and nothing else.
 */

export type GuestStatusTone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'error' | 'info';

export type GuestStatusContent =
  | { kind: 'bar'; value: number; tone?: GuestStatusTone }
  | { kind: 'chart'; values: number[]; max?: number; tone?: GuestStatusTone; unit?: 'bytes' | 'percent' | 'count'; step?: number }
  | { kind: 'chips'; chips: Array<{ id: string; label: string; tone?: GuestStatusTone; url?: string }> }
  | { kind: 'text'; text: string; tone?: GuestStatusTone }
  | {
      kind: 'segmented';
      id: string;
      label: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      disabled?: boolean;
    };

export type GuestStatusAction =
  | { kind: 'button'; id: string; label: string; variant?: 'default' | 'outline' | 'destructive'; confirm?: string; disabled?: boolean }
  | { kind: 'switch'; id: string; label: string; checked: boolean; disabled?: boolean }
  | { kind: 'select'; id: string; label: string; value: string; options: Array<{ value: string; label: string }>; disabled?: boolean };

export type GuestStatusRow =
  | {
      kind: 'line';
      id: string;
      label: string;
      icon?: string;
      dot?: GuestStatusTone;
      content?: GuestStatusContent;
      value?: string;
      valueTone?: GuestStatusTone;
      badge?: { label: string; tone?: GuestStatusTone };
      tooltip?: string;
      actions?: GuestStatusAction[];
    }
  | { kind: 'note'; id: string; text: string; tone?: 'muted' | 'info' | 'warning' | 'error' };

export interface GuestStatusView {
  rows: GuestStatusRow[];
}
