/**
 * Form wizard app — multi-step form with validation.
 *
 * Exercises: input fields, focus management, conditional rendering
 * (step transitions), form state, validation feedback.
 */

import { defineApp, box, text, column, row, input, clickable, separator } from '../app-sdk/index.js';
import type { AppConnection } from '../core/types.js';

const ID = {
  ROOT: 1,
  TITLE: 2,
  STEP_INDICATOR: 3,
  FORM_AREA: 10,
  // Step 1: Personal info
  S1_NAME_LABEL: 100,
  S1_NAME_INPUT: 101,
  S1_NAME_ERROR: 102,
  S1_EMAIL_LABEL: 103,
  S1_EMAIL_INPUT: 104,
  S1_EMAIL_ERROR: 105,
  // Step 2: Preferences
  S2_ROLE_LABEL: 200,
  S2_ROLE_OPTIONS: 201, // base for role option boxes
  S2_THEME_LABEL: 210,
  S2_THEME_OPTIONS: 211,
  S2_NOTIFY_LABEL: 220,
  S2_NOTIFY_TOGGLE: 221,
  S2_NOTIFY_TEXT: 222,
  // Step 3: Review
  S3_SUMMARY: 300,
  S3_NAME_VALUE: 301,
  S3_EMAIL_VALUE: 302,
  S3_ROLE_VALUE: 303,
  S3_THEME_VALUE: 304,
  S3_NOTIFY_VALUE: 305,
  S3_CONFIRM: 306,
  // Navigation
  NAV: 400,
  BACK_BTN: 401,
  BACK_LABEL: 402,
  NEXT_BTN: 403,
  NEXT_LABEL: 404,
  STATUS: 410,
} as const;

interface FormData {
  name: string;
  email: string;
  role: string;
  theme: string;
  notifications: boolean;
}

const ROLES = ['Developer', 'Designer', 'Manager', 'Other'];
const THEMES = ['Dark', 'Light', 'System'];

export const formWizardApp = defineApp({
  name: 'form-wizard',
  description: 'Multi-step form with inputs, validation, and review. Tests inputs, focus, conditional rendering.',

  setup(conn: AppConnection) {
    let step = 0; // 0=personal, 1=preferences, 2=review
    let submitted = false;
    const form: FormData = {
      name: '',
      email: '',
      role: 'Developer',
      theme: 'Dark',
      notifications: true,
    };
    const errors: Partial<Record<keyof FormData, string>> = {};

    function validate(): boolean {
      let valid = true;
      delete errors.name;
      delete errors.email;

      if (step === 0) {
        if (!form.name.trim()) {
          errors.name = 'Name is required';
          valid = false;
        }
        if (!form.email.trim()) {
          errors.email = 'Email is required';
          valid = false;
        } else if (!form.email.includes('@')) {
          errors.email = 'Invalid email format';
          valid = false;
        }
      }
      return valid;
    }

    function stepIndicator() {
      const labels = ['Personal Info', 'Preferences', 'Review'];
      return row({ id: ID.STEP_INDICATOR, gap: 4, padding: [0, 0, 12, 0] },
        labels.map((l, i) =>
          row({ gap: 4, align: 'center' }, [
            box({
              width: 24, height: 24,
              background: i <= step ? '#89b4fa' : '#313244',
              borderRadius: 12,
              justify: 'center',
              align: 'center',
            }, [
              text({ content: i < step ? '✓' : String(i + 1), color: i <= step ? '#1e1e2e' : '#6c7086', size: 12 }),
            ]),
            text({
              content: l,
              weight: i === step ? 'bold' : 'normal',
              color: i <= step ? '#cdd6f4' : '#6c7086',
            }),
            ...(i < labels.length - 1 ? [
              text({ content: '—', color: '#45475a' }),
            ] : []),
          ])
        )
      );
    }

    function optionButton(id: number, label: string, selected: boolean) {
      return clickable({
        id,
        padding: [6, 16],
        borderRadius: 4,
        border: { width: 1, color: selected ? '#89b4fa' : '#45475a', style: 'solid' },
        background: selected ? '#313244' : undefined,
      }, [
        text({ content: label, color: selected ? '#89b4fa' : '#cdd6f4' }),
      ]);
    }

    function step1() {
      return column({ id: ID.FORM_AREA, gap: 16 }, [
        // Name field
        column({ gap: 4 }, [
          text({ id: ID.S1_NAME_LABEL, content: 'Full Name', weight: 'bold' }),
          input({ id: ID.S1_NAME_INPUT, value: form.name, placeholder: 'Enter your name', width: 300 }),
          ...(errors.name ? [text({ id: ID.S1_NAME_ERROR, content: errors.name, color: '#f38ba8', size: 12 })] : []),
        ]),
        // Email field
        column({ gap: 4 }, [
          text({ id: ID.S1_EMAIL_LABEL, content: 'Email Address', weight: 'bold' }),
          input({ id: ID.S1_EMAIL_INPUT, value: form.email, placeholder: 'you@example.com', width: 300 }),
          ...(errors.email ? [text({ id: ID.S1_EMAIL_ERROR, content: errors.email, color: '#f38ba8', size: 12 })] : []),
        ]),
      ]);
    }

    function step2() {
      return column({ id: ID.FORM_AREA, gap: 16 }, [
        // Role selection
        column({ gap: 8 }, [
          text({ id: ID.S2_ROLE_LABEL, content: 'Role', weight: 'bold' }),
          row({ gap: 8 },
            ROLES.map((role, i) => optionButton(ID.S2_ROLE_OPTIONS + i, role, form.role === role))
          ),
        ]),
        // Theme selection
        column({ gap: 8 }, [
          text({ id: ID.S2_THEME_LABEL, content: 'Theme', weight: 'bold' }),
          row({ gap: 8 },
            THEMES.map((theme, i) => optionButton(ID.S2_THEME_OPTIONS + i, theme, form.theme === theme))
          ),
        ]),
        // Notifications toggle
        row({ gap: 12, align: 'center' }, [
          text({ id: ID.S2_NOTIFY_LABEL, content: 'Email Notifications', weight: 'bold' }),
          clickable({
            id: ID.S2_NOTIFY_TOGGLE,
            width: 48, height: 24,
            borderRadius: 12,
            background: form.notifications ? '#89b4fa' : '#313244',
            padding: 2,
            justify: form.notifications ? 'end' : 'start',
          }, [
            box({ width: 20, height: 20, borderRadius: 10, background: '#fff' }),
          ]),
          text({ id: ID.S2_NOTIFY_TEXT, content: form.notifications ? 'On' : 'Off', color: '#6c7086' }),
        ]),
      ]);
    }

    function step3() {
      return column({ id: ID.FORM_AREA, gap: 12 }, [
        text({ id: ID.S3_SUMMARY, content: 'Review your information:', weight: 'bold', size: 16 }),
        separator(),
        row({ gap: 8 }, [
          text({ content: 'Name:', weight: 'bold', width: 120 }),
          text({ id: ID.S3_NAME_VALUE, content: form.name }),
        ]),
        row({ gap: 8 }, [
          text({ content: 'Email:', weight: 'bold', width: 120 }),
          text({ id: ID.S3_EMAIL_VALUE, content: form.email }),
        ]),
        row({ gap: 8 }, [
          text({ content: 'Role:', weight: 'bold', width: 120 }),
          text({ id: ID.S3_ROLE_VALUE, content: form.role }),
        ]),
        row({ gap: 8 }, [
          text({ content: 'Theme:', weight: 'bold', width: 120 }),
          text({ id: ID.S3_THEME_VALUE, content: form.theme }),
        ]),
        row({ gap: 8 }, [
          text({ content: 'Notifications:', weight: 'bold', width: 120 }),
          text({ id: ID.S3_NOTIFY_VALUE, content: form.notifications ? 'Enabled' : 'Disabled' }),
        ]),
      ]);
    }

    function buildTree() {
      if (submitted) {
        conn.setTree(
          column({ id: ID.ROOT, padding: 24, gap: 16, align: 'center' }, [
            text({ content: '✓', size: 48, color: '#a6e3a1' }),
            text({ content: 'Registration Complete!', weight: 'bold', size: 20 }),
            text({ content: `Welcome, ${form.name}!`, color: '#6c7086' }),
          ])
        );
        return;
      }

      const stepContent = step === 0 ? step1() : step === 1 ? step2() : step3();

      conn.setTree(
        column({ id: ID.ROOT, padding: 16, gap: 12 }, [
          text({ id: ID.TITLE, content: 'Registration', weight: 'bold', size: 20 }),
          stepIndicator(),
          separator(),
          stepContent,
          separator(),
          // Navigation buttons
          row({ id: ID.NAV, gap: 12, justify: 'end' }, [
            ...(step > 0 ? [
              clickable({
                id: ID.BACK_BTN,
                padding: [8, 20],
                borderRadius: 4,
                border: { width: 1, color: '#45475a', style: 'solid' },
              }, [
                text({ id: ID.BACK_LABEL, content: 'Back' }),
              ]),
            ] : []),
            clickable({
              id: ID.NEXT_BTN,
              padding: [8, 20],
              borderRadius: 4,
              background: '#89b4fa',
            }, [
              text({ id: ID.NEXT_LABEL, content: step === 2 ? 'Submit' : 'Next', color: '#1e1e2e', weight: 'bold' }),
            ]),
          ]),
        ])
      );
    }

    buildTree();

    conn.onInput((event) => {
      if (event.kind === 'value_change') {
        switch (event.target) {
          case ID.S1_NAME_INPUT:
            form.name = event.value ?? '';
            break;
          case ID.S1_EMAIL_INPUT:
            form.email = event.value ?? '';
            break;
        }
      }

      if (event.kind === 'click') {
        const t = event.target ?? 0;

        // Navigation
        if (t === ID.BACK_BTN || t === ID.BACK_LABEL) {
          if (step > 0) { step--; buildTree(); }
          return;
        }
        if (t === ID.NEXT_BTN || t === ID.NEXT_LABEL) {
          if (step === 2) {
            submitted = true;
            buildTree();
          } else if (validate()) {
            step++;
            buildTree();
          } else {
            buildTree(); // show errors
          }
          return;
        }

        // Role options
        for (let i = 0; i < ROLES.length; i++) {
          if (t === ID.S2_ROLE_OPTIONS + i) {
            form.role = ROLES[i];
            buildTree();
            return;
          }
        }

        // Theme options
        for (let i = 0; i < THEMES.length; i++) {
          if (t === ID.S2_THEME_OPTIONS + i) {
            form.theme = THEMES[i];
            buildTree();
            return;
          }
        }

        // Notifications toggle
        if (t === ID.S2_NOTIFY_TOGGLE) {
          form.notifications = !form.notifications;
          buildTree();
        }
      }
    });

    return {};
  },
});
