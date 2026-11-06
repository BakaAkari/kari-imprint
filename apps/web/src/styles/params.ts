/**
 * Parameter-built styles: a style is a pure function of a few named
 * parameters. The parameters are stored on the config (`style_params`), the
 * layers are derived from them, and every knob is "rebuild with one parameter
 * changed". Parts a style does not own (the signature region) survive.
 */

import type { ImprintConfig } from '../types';
import type { KnobOption, StyleKnob } from './knobs';
import { MAX_KNOBS_PER_STYLE } from './knobs';

export type ParamValue = string | number | boolean;
/** What a style constructs; the helper adds schema_version, style_id and style_params. */
export type StyleBody = Omit<ImprintConfig, 'schema_version' | 'style_id' | 'style_params'>;
export type Params = Record<string, ParamValue>;

type KeyOf<P, V> = { [K in keyof P]: P[K] extends V ? K : never }[keyof P] & string;

export type KnobDef<P extends Params> =
  | { kind: 'range'; key: KeyOf<P, number>; label: string; min: number; max: number; step: number }
  | { kind: 'swatch'; key: KeyOf<P, string>; label: string; options: readonly KnobOption[] }
  | { kind: 'choice'; key: KeyOf<P, string>; label: string; options: readonly KnobOption[] }
  | { kind: 'toggle'; key: KeyOf<P, boolean>; label: string }
  | { kind: 'text'; key: KeyOf<P, string>; label: string; placeholder: string; maxLength: number };

export interface ParamStyle<P extends Params> {
  build: (params?: Partial<P>) => ImprintConfig;
  read: (config: ImprintConfig) => P;
  knobs: StyleKnob[];
}

export function paramStyle<P extends Params>(
  id: string,
  defaults: P,
  construct: (params: P) => StyleBody,
  knobDefs: readonly KnobDef<P>[],
): ParamStyle<P> {
  if (knobDefs.length > MAX_KNOBS_PER_STYLE) throw new Error(`${id}: more than ${MAX_KNOBS_PER_STYLE} knobs`);
  const read = (config: ImprintConfig): P => {
    const stored = config.style_id === id ? config.style_params ?? {} : {};
    const merged = { ...defaults } as Record<string, ParamValue>;
    for (const key of Object.keys(defaults)) {
      const value = stored[key];
      if (value !== undefined && typeof value === typeof defaults[key]) merged[key] = value;
    }
    return merged as P;
  };
  const build = (params?: Partial<P>): ImprintConfig => {
    const p = { ...defaults, ...params } as P;
    return { schema_version: 3, style_id: id, style_params: { ...p }, ...construct(p) };
  };
  const rebuild = (config: ImprintConfig, patch: Partial<P>): ImprintConfig => {
    const next = build({ ...read(config), ...patch });
    return { ...next, regions: [...next.regions, ...config.regions.filter((region) => region.type === 'free')] };
  };
  const knobs = knobDefs.map((def) => ({
    ...def,
    id: def.key,
    get: (config: ImprintConfig) => read(config)[def.key],
    set: (config: ImprintConfig, value: ParamValue) => rebuild(config, { [def.key]: value } as Partial<P>),
  })) as unknown as StyleKnob[];
  return { build, read, knobs };
}
