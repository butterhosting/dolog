import { $containerEvent } from "@/drizzle/schema";
import { Uuid } from "@/helpers/Uuid";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { LogPattern } from "@/models/LogPattern";
import { BinaryOperator, gt, gte, lt, lte, sql, SQL } from "drizzle-orm";
// type-only, so the two files do not form a cycle at runtime: only the types travel this way
import type { EventRepository } from "./EventRepository";

/**
 * Each concept owns both halves of itself: the test that decides, and the clauses that narrow what
 * sqlite hands over before it is asked.
 *
 * The contract between the two is that a `partial` database test is a *prefilter*, never the
 * verdict -- it only has to be no stricter than its `fullInMemoryTest`. That is what lets a
 * substring narrow the scan while a regular expression, which sqlite cannot evaluate, narrows
 * nothing. A `full` database test is the exception that says so in its name: a cursor is a
 * comparison sqlite performs exactly, so there is nothing left for the predicate to catch.
 */
export namespace EventPredicateFactory {
  export type Candidate = {
    id: string;
    line: string | null;
  };

  export function forSearch({ logPattern, anchorId, anchorInclusivity, direction }: EventRepository.Search): {
    fullInMemoryTest(candidate: Candidate): boolean;
    partialDatabaseTest(cursor: string | undefined): Array<SQL<unknown> | undefined>;
  } {
    const isInclusive = anchorInclusivity === "inclusive";
    // full in-memory test
    const patternPredicate = LogPattern.predicate(logPattern);
    const beyondPredicate = ({ id }: Candidate): boolean => {
      if (anchorId === undefined) {
        return true;
      }
      if (id === anchorId) {
        return isInclusive;
      }
      switch (direction) {
        case Direction.forwards_in_time:
          return id > anchorId;
        case Direction.backwards_in_time:
          return id < anchorId;
      }
    };
    // partial database test
    const extraClause = logPattern.patternVariant === LogPattern.Variant.substr ? sqlSubstring(logPattern.pattern) : undefined;
    return {
      fullInMemoryTest: (candidate) => beyondPredicate(candidate) && candidate.line !== null && patternPredicate(candidate.line),
      partialDatabaseTest: (cursor) => {
        if (cursor === undefined) {
          return [extraClause];
        }
        /**
         * Inclusivity belongs to the anchor, never to a resumption: a walk resuming from the last row
         * it read must exclude it, or it would read that row forever. Rather than have the caller
         * remember to say so, the anchor is recognised here -- any other cursor is a resumption.
         */
        const openingTheWalk = isInclusive && cursor === anchorId;
        let anchorBound: BinaryOperator;
        switch (direction) {
          case Direction.forwards_in_time:
            anchorBound = openingTheWalk ? gte : gt;
            break;
          case Direction.backwards_in_time:
            anchorBound = openingTheWalk ? lte : lt;
            break;
        }
        return [anchorBound($containerEvent.id, Uuid.toBytes(cursor)), extraClause];
      },
    };
  }

  export function forCursor({ before, beforeInclusivity, after, afterInclusivity }: EventRepository.Cursor): {
    fullDatabaseTest(): Array<SQL<unknown> | undefined>;
    fullInMemoryTest(event: ContainerEvent): boolean;
  } {
    const clauses: Array<SQL<unknown> | undefined> = [];
    if (before !== undefined) {
      switch (beforeInclusivity) {
        case "exclusive": {
          clauses.push(lt($containerEvent.id, Uuid.toBytes(before)));
          break;
        }
        default:
          throw new Error(`Unsupported inclusivity: ${beforeInclusivity}`);
      }
    }
    if (after !== undefined) {
      switch (afterInclusivity) {
        case "inclusive":
          clauses.push(gte($containerEvent.id, Uuid.toBytes(after)));
          break;
        case "exclusive":
          clauses.push(gt($containerEvent.id, Uuid.toBytes(after)));
          break;
        default:
          throw new Error(`Unsupported inclusivity: ${afterInclusivity}`);
      }
    }
    return {
      fullDatabaseTest() {
        return clauses;
      },
      fullInMemoryTest(event: ContainerEvent) {
        return (
          (before === undefined || event.id < before) &&
          (after === undefined || (afterInclusivity === "inclusive" ? event.id >= after : event.id > after))
        );
      },
    };
  }

  export function forFilter({ logPattern, since, until }: EventRepository.Filter): {
    fullInMemoryTest(candidate: Candidate): boolean;
    partialDatabaseTest(): Array<SQL<unknown> | undefined>;
  } {
    // full in-memory test
    const patternPredicate = logPattern ? LogPattern.predicate(logPattern) : undefined;
    const sinceId = since === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(since));
    const untilId = until === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(until));
    // partial database test
    const clauses: Array<SQL<unknown> | undefined> = [
      since === undefined ? undefined : gte($containerEvent.id, Uuid.lowerBoundAt(since)),
      until === undefined ? undefined : lt($containerEvent.id, Uuid.lowerBoundAt(until)),
      logPattern?.patternVariant === LogPattern.Variant.substr ? sqlSubstring(logPattern.pattern) : undefined,
    ];
    return {
      fullInMemoryTest(candidate) {
        return (
          (sinceId === undefined || candidate.id >= sinceId) &&
          (untilId === undefined || candidate.id < untilId) &&
          (patternPredicate === undefined || (candidate.line !== null && patternPredicate(candidate.line)))
        );
      },
      partialDatabaseTest() {
        return clauses;
      },
    };
  }

  /**
   * The `like` prefilter for a literal needle, with sqlite's own wildcards defanged.
   *
   * It may stand in for the predicate across every needle only because {@link LogPattern.predicate}
   * folds case exactly as `like` does -- `a-z` and no further. Were the predicate to fold more, this
   * would become the *stricter* of the two, and a row rejected here is never carried back to be
   * tested: `'café' like '%CAFÉ%'` is false, and `İ`, an `i` once javascript has lowered it, is not
   * one to sqlite.
   */
  function sqlSubstring(needle: string): SQL<unknown> {
    const escaped = needle.replace(/[\\%_]/g, (character) => `\\${character}`);
    return sql`${$containerEvent.line} like ${`%${escaped}%`} escape '\\'`;
  }
}
