// Core structural model
export { type Signal, type SignalTransition, X, SIGNALS, isSignal } from "./core/signal.js";
export type {
  CircuitScope,
  ComponentDefinition,
  ComponentDescription,
  ComponentInstance,
  ConnectionDescription,
  Direction,
  Port,
  PortDescription,
  PortRole,
  SinkPort,
  SourcePort,
} from "./core/component.js";
export { gate, type GateSpec } from "./core/gate.js";
export { circuit, type CircuitBuilder, type CircuitSpec, type InputWiring } from "./core/circuit.js";
export { elaborate, type Ancestor, type GateInfo, type NetInfo, type Netlist } from "./core/elaborate.js";

// Simulation
export {
  simulate,
  type RunResult,
  type SimulationOptions,
  type SimulationSnapshot,
  type Simulator,
} from "./simulation/simulator.js";

// Errors
export {
  CircuitError,
  WiresError,
  SimulationError,
  StabilizationError,
  type StabilizationDetails,
} from "./core/errors.js";
