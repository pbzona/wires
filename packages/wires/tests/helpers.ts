import { type ComponentDefinition, type Signal, simulate } from "wires";

/** Simulates `definition` from a fresh state with the given inputs until stable. */
export function evaluate<I extends string, O extends string>(
  definition: ComponentDefinition<I, O>,
  inputs: { readonly [K in I]?: Signal },
): { [K in O]: Signal } {
  const sim = simulate(definition);
  sim.set(inputs);
  sim.run();
  return sim.readAll();
}

/** Every assignment of 0/1 to `names`, in binary counting order (first name is the MSB). */
export function binaryCombinations<N extends string>(names: readonly N[]): Array<Record<N, 0 | 1>> {
  const rows: Array<Record<N, 0 | 1>> = [];
  for (let i = 0; i < 1 << names.length; i++) {
    const row = {} as Record<N, 0 | 1>;
    names.forEach((name, bit) => {
      row[name] = ((i >> (names.length - 1 - bit)) & 1) as 0 | 1;
    });
    rows.push(row);
  }
  return rows;
}

export const bit = (value: boolean): 0 | 1 => (value ? 1 : 0);
