/**
 * Style knobs — the few user-facing controls a style declares (at most five).
 *
 * A knob reads its value from a config and writes a new config. Knobs of the
 * engine-built families rebuild the style from its parameters, so the album
 * look patch model keeps working: a knob change is just a config change.
 */

import type { ImprintConfig } from '../types';

export interface KnobOption<T extends string = string> {
  value: T;
  label: string;
}

interface KnobBase<T> {
  id: string;
  label: string;
  get: (config: ImprintConfig) => T;
  set: (config: ImprintConfig, value: T) => ImprintConfig;
}

/** A ratio of the photo short edge, shown as a percentage. */
export interface RangeKnob extends KnobBase<number> {
  kind: 'range';
  min: number;
  max: number;
  step: number;
}

/** Colour swatches. */
export interface SwatchKnob extends KnobBase<string> {
  kind: 'swatch';
  options: readonly KnobOption[];
}

/** A short list of named choices. */
export interface ChoiceKnob extends KnobBase<string> {
  kind: 'choice';
  options: readonly KnobOption[];
}

export interface ToggleKnob extends KnobBase<boolean> {
  kind: 'toggle';
}

/** Free text, length-limited by the API (160 characters). */
export interface TextKnob extends KnobBase<string> {
  kind: 'text';
  placeholder: string;
  maxLength: number;
}

export type StyleKnob = RangeKnob | SwatchKnob | ChoiceKnob | ToggleKnob | TextKnob;

export const MAX_KNOBS_PER_STYLE = 5;
