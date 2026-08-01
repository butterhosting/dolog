import { Temporal } from "@js-temporal/polyfill";

/**
 * Some models that I'm thinking of
 */

 type Container = {
  name: string;
  group?: string; // in compose projects, this might be the `project` name, and in swarm stacks, this might be the `stack` name? or whatever the umbrella group is for multiple services within a "stack"
};

type ContainerEvent =
  | ContainerEvent.Start
  | ContainerEvent.Stop
  | ContainerEvent.Log
  | ContainerEvent.Throttle;

namespace ContainerEvent {

  export enum Type {
    start = "start",
    stop = "stop",
    log = "log",
    throttle = "throttle",
  };

  type Common = {
    timestamp: Temporal.Instant;
    container: Container;
  };

  export type Start = Common & {
    type: Type.start;
  };

  export type Stop = Common & {
    type: Type.stop;
  };

  export type Log = Common & {
    type: Type.log;
    message: string;
  };

  export type Throttle = Common & {
    type: Type.throttle;
    foldCount: number,
    // don't know if this is the right term, and don't know how technically feasible this is
    // but would be nice if containers who are "too chatty" see their messages dropped by the throttler,
    // or at least see them "folded" into a single "Throttle" event, containing a count of how many messages we just folded (contents can be discarded)
  };

};

/**
 * Some technical direction that i'm thinking of...
 */

// i really want to use Rx for this stuff, i think Observables are a natural fit for this app
type Observable<T> = undefined;

// the `fountain` is like an abstraction for something producing container events
// (and this abstraction should make it easy to swap out for something unit-testable)
interface Fountain {

  // once it's "turned on" (which happes exactly once in the application lifecycle),
  // then it should emit these events forever:
  //  - if new containers come online, they automatically see their events emitted
  //  - if containers die, they stop emitting
  //  - if the socket dies .. log a warning to the console, but keep listening and when it comes up again, continue
  initialize(): Observable<ContainerEvent>;
  // this should only emit the start/stop/log events, not throttle (we'll get to that)

}

interface Throttler {

  // i dont know for sure about this interface and if it makes sense, but the main concept is this:
  // - throttler should calculate, per container, what the current throughput is (logs/second and bytes/second)
  // - in fact, it should keep those stats in some local state, so it owns a live "throughput" dashboard
  // - its allowed to remove stats from its dashboard after there's been no activity for 5 minutes (throughput of zero)

  throttle(events: Observable<ContainerEvent>): Observable<ContainerEvent>;
  // so all in all, i dont know if the above throttle method makes sense;
  // i thought: a way to convert an event stream into a throttled event stream...
  // so i'm open for suggestions
  //
  // one thing tho: at some point, i'd like this throttler to expose its internal "throughput dashboard"
  // to the outside (so it can ultimately be shown on the frontend, but thats for later)
  //
  // but again .. not sure if this should be a "service" or just an rx operator .. idk

}

/**
 * if all of the above is more or less in place that'd be great!
 *
 * once this throttled stream is constructed, just add 1 observer for now, which logs it to the console,
 * before we continue this project ..
 *
 * also, you can assume a normal docker socket sitting in the usual location,
 * and if it helps, remember this is bun, so maybe there's a node library to simplify interacting
 * with the socket ... this is a decision moment, so let me know whatever you contemplate.
 */

 /**
  * broader, in terms of architecture:
  *
  * once we have this clean stream coming in, together with some kind of "dashboard" somewhere,
  * showing throughput rates per container, we're in a good spot
  *
  * from here on out, i'd like to multicast in multiple directions, such as:
  * - the database (depending on retention rules, etc.)
  * - an alerting service (which owns regex rules, and alert destinations.)
  * - the frontend (if it opens a websocket for a particular container)
  *
  * For the frontend, for example, i imagine this nice overview of all running containers
  * (with some UI/UX design i havent figured out yet, for also showing older logs for containers which have since died)
  *
  * And then the little container preview shows things like current throughput stats,
  * and when you click on it, you get connected to the logs for that particular container via
  * a websocket
  *
  * and here you see the different ContainerEvents, like actual log messages interleaved with
  * container events and "throttle" events
  */

  /**
   * So the MVP i laid out above: no need for frontend, necessarily, just fountain and a throttler,
   * creating a nice clean stream which sees its contents logged to stdout
   */
