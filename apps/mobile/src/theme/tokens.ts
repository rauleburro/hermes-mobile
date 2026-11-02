import { Platform, type TextStyle } from 'react-native';

export type ColorRoles = {
  bg: string;
  surface: string;
  elevated: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  separator: string;
  accent: string;
  attention: string;
  danger: string;
  /** Solid danger background (Android draws a Button's color as its background). */
  dangerFill: string;
  /** Label on `dangerFill`: React Native draws Android Button labels white. */
  onDangerFill: string;
  success: string;
};

export const colors: { light: ColorRoles; dark: ColorRoles } = {
  dark: {
    bg: '#0E0F12',
    surface: '#1B1D22',
    elevated: '#25282F',
    text: '#F2F3F5',
    textSecondary: '#A3A8B3',
    textTertiary: '#6C7280',
    separator: '#2D3139',
    accent: '#7C8BFF',
    attention: '#FF9F45',
    danger: '#FF6369',
    dangerFill: '#CD2B31',
    onDangerFill: '#FFFFFF',
    success: '#4CC38A',
  },
  light: {
    bg: '#FFFFFF',
    surface: '#F2F3F5',
    elevated: '#FFFFFF',
    text: '#111318',
    textSecondary: '#5A606C',
    textTertiary: '#8A909B',
    separator: '#E2E4E8',
    accent: '#3B4BDB',
    attention: '#C25E00',
    danger: '#CD2B31',
    dangerFill: '#CD2B31',
    onDangerFill: '#FFFFFF',
    success: '#18794E',
  },
};

export type TypeStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: NonNullable<TextStyle['fontWeight']>;
  fontFamily?: string;
};

export const typography = {
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  mono: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
} satisfies Record<string, TypeStyle>;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 20, tail: 6, full: 9999 } as const;

export const sizes = {
  roundButton: 44,
  avatarRoster: 56,
  avatarHero: 96,
  avatarPill: 28,
  avatarInline: 20,
  composerMin: 48,
} as const;
