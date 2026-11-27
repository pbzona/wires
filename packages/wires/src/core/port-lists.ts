import { assertName } from "./component.js";
import { CircuitError } from "./errors.js";
import { describeValue } from "./signal.js";

/** A named, ordered group of single-bit ports in a circuit declaration. */
export type BitGroup<Name extends string = string> = {
  readonly name: Name;
  readonly width: number;
};

function checkWidth(name: string, width: number): void {
  if (!Number.isSafeInteger(width) || width < 1 || width > 0xffff_ffff) {
    throw new CircuitError(`bits("${name}") width must be a positive integer that fits an array (got ${describeValue(width)})`);
  }
}

/** Declare a group: bits("d", 8) names the ordinary pins d0 through d7. */
export function bits<const N extends string>(name: N, width: number): BitGroup<N> {
  assertName(name, "port group name");
  checkWidth(name, width);
  return Object.freeze({ name, width });
}

export type PortDeclaration = string | BitGroup;
export type GroupName<L extends readonly PortDeclaration[]> = Extract<L[number], BitGroup>["name"];
export type PinName<L extends readonly PortDeclaration[]> = Extract<L[number], string> | `${GroupName<L>}${number}`;
export type GroupMembers<G extends string, P extends string> = { readonly [K in G]: readonly P[] };

type PortList<P extends readonly PortDeclaration[]> = {
  readonly names: readonly PinName<P>[];
  readonly groups: GroupMembers<GroupName<P>, PinName<P>>;
};

/** Expand groups once. The builder uses the groups; everything below it uses the flat pin names. */
export function validatePortLists<I extends readonly PortDeclaration[], O extends readonly PortDeclaration[]>(
  name: string, inputs: I, outputs: O, kind: "primitive" | "composite",
): { inputs: PortList<I>; outputs: PortList<O> } {
  const seen = new Set<string>();
  const reserve = (pin: string) => {
    if (seen.has(pin)) throw new CircuitError(`Duplicate port name "${pin}"`, name);
    seen.add(pin);
  };
  const expand = <P extends readonly PortDeclaration[]>(list: P, direction: "input" | "output"): PortList<P> => {
    if (!Array.isArray(list)) throw new CircuitError(`${direction}s must be an array of port names`, name);
    const names: string[] = [];
    const groups: Record<string, readonly string[]> = {};
    for (const port of list) {
      if (kind === "composite" && typeof port === "object" && port !== null) {
        const { name: group, width } = port;
        assertName(group, "port group name", name);
        checkWidth(group, width);
        reserve(group);
        const members: string[] = [];
        for (let i = 0; i < width; i++) {
          const pin = `${group}${i}`;
          reserve(pin);
          names.push(pin);
          members.push(pin);
        }
        groups[group] = Object.freeze(members);
      } else {
        assertName(port, `${direction} port name`, name);
        reserve(port);
        names.push(port);
      }
    }
    return {
      names: Object.freeze(names) as readonly PinName<P>[],
      groups: Object.freeze(groups) as GroupMembers<GroupName<P>, PinName<P>>,
    };
  };
  return { inputs: expand(inputs, "input"), outputs: expand(outputs, "output") };
}
