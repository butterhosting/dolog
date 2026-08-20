import { $containerEvent } from "@/drizzle/schema";
import { LogError } from "@/errors/LogError";
import { Direction } from "@/models/Direction";
import { Filter } from "@/models/Filter";
import { Pattern } from "@/models/Pattern";
import { EventRepository } from "@/repositories/EventRepository";
import { gt, gte, lt, lte, sql, SQL } from "drizzle-orm";
import { Uuid } from "../models/Uuid";
import { ContainerEvent } from "@/models/ContainerEvent";

export namespace PredicateFactory {
  export type Candidate = Pick<ContainerEvent.Log, "id"> & Partial<Pick<ContainerEvent.Log, "line">>;

  export function forPattern(exhaustiveness: "full_object_test", pattern: Pattern): (line: string) => boolean;
  export function forPattern(exhaustiveness: "partial_database_test", pattern: Pattern): () => Array<SQL<unknown>>;
  export function forPattern(
    exhaustiveness: "full_object_test" | "partial_database_test",
    { type, value }: Pattern,
  ): ((line: string) => boolean) | (() => Array<SQL<unknown>>) {
    switch (exhaustiveness) {
      case "full_object_test": {
        try {
          switch (type) {
            case Pattern.Type.substr: {
              const lowered = asciiLower(value);
              return (line) => asciiLower(line).includes(lowered);
            }
            case Pattern.Type.regex: {
              const compiled = new RegExp(value);
              return (line) => compiled.test(line);
            }
            default: {
              (type) satisfies never;
            }
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw LogError.invalid_regex_pattern({
              pattern: value,
              reason: error.message,
            });
          }
          throw error;
        }
      }
      case "partial_database_test": {
        const clauses: Array<SQL<unknown>> = [];
        if (type === Pattern.Type.substr) {
          clauses.push(sqlSubstring(value));
        }
        return () => clauses;
      }
    }
  }

  export function forFilter(exhaustiveness: "full_object_test", filter: Filter): (candidate: Candidate) => boolean;
  export function forFilter(exhaustiveness: "partial_database_test", filter: Filter): () => Array<SQL<unknown>>;
  export function forFilter(
    exhaustiveness: "full_object_test" | "partial_database_test",
    { pattern, since, until }: Filter,
  ): ((line: Candidate) => boolean) | (() => Array<SQL<unknown>>) {
    switch (exhaustiveness) {
      case "full_object_test": {
        const patternPredicate = pattern ? forPattern("full_object_test", pattern) : undefined;
        const sinceId = since === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(since));
        const untilId = until === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(until));
        return (candidate) =>
          (patternPredicate === undefined || (candidate.line ? patternPredicate(candidate.line) : false)) &&
          (sinceId === undefined || candidate.id >= sinceId) &&
          (untilId === undefined || candidate.id < untilId);
      }
      case "partial_database_test": {
        const clauses: Array<SQL<unknown>> = [];
        if (pattern?.type === Pattern.Type.substr) {
          clauses.push(sqlSubstring(pattern.value));
        }
        if (since) {
          clauses.push(gte($containerEvent.id, Uuid.lowerBoundAt(since)));
        }
        if (until) {
          clauses.push(lt($containerEvent.id, Uuid.lowerBoundAt(until)));
        }
        return () => clauses;
      }
    }
  }

  export function forSearch(exhaustiveness: "full_object_test", search: EventRepository.Search): (candidate: Candidate) => boolean;
  export function forSearch(
    exhaustiveness: "partial_database_test",
    search: EventRepository.Search,
  ): (cursor: string | undefined) => Array<SQL<unknown>>;
  export function forSearch(
    exhaustiveness: "full_object_test" | "partial_database_test",
    { pattern, anchorId, anchorInclusivity, direction }: EventRepository.Search,
  ): ((candidate: Candidate) => boolean) | ((cursor: string | undefined) => Array<SQL<unknown>>) {
    const isInclusive = anchorInclusivity === "inclusive";
    switch (exhaustiveness) {
      case "full_object_test": {
        const patternPredicate = forPattern("full_object_test", pattern);
        const anchorPredicate = ({ id }: Candidate): boolean => {
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
        return (candidate: Candidate) => anchorPredicate(candidate) && (candidate.line ? patternPredicate(candidate.line) : false);
      }
      case "partial_database_test": {
        const patternClause = pattern.type === Pattern.Type.substr ? [sqlSubstring(pattern.value)] : [];
        return (cursor: string | undefined) => {
          if (cursor === undefined) {
            return [...patternClause];
          }
          const $id = $containerEvent.id;
          const cursorBytes = Uuid.toBytes(cursor);
          //
          // Important: "anchorInclusivity" only has meaning for the very first request, where `cursor === anchorId`
          //
          // We're not returning SQL clauses but a reusable function that's meant to be called repeatably for cursor-based listing...
          // ...subsequent requests will pass a different cursor (i.e.: the "outermost" value of the most recently returned list),
          // and those cursors need to be "exclusive" by definition
          //
          const isFirstCursor = isInclusive && cursor === anchorId;
          let anchorClause: SQL<unknown>;
          switch (direction) {
            case Direction.forwards_in_time: {
              anchorClause = isFirstCursor ? gte($id, cursorBytes) : gt($id, cursorBytes);
              break;
            }
            case Direction.backwards_in_time: {
              anchorClause = isFirstCursor ? lte($id, cursorBytes) : lt($id, cursorBytes);
              break;
            }
          }
          return [anchorClause, ...patternClause];
        };
      }
    }
  }

  export function forCursor(exhaustiveness: "full_object_test", cursor: EventRepository.Cursor): (candidate: Candidate) => boolean;
  export function forCursor(exhaustiveness: "full_database_test", cursor: EventRepository.Cursor): () => Array<SQL<unknown>>;
  export function forCursor(
    exhaustiveness: "full_object_test" | "full_database_test",
    { before, beforeInclusivity, after, afterInclusivity }: EventRepository.Cursor,
  ): ((candidate: Candidate) => boolean) | (() => Array<SQL<unknown>>) {
    //
    // ⚠️
    // ⚠️ Remember; `beforeInclusivity` can only ever be `exclusive`, never `inclusive`
    // ⚠️
    //
    switch (exhaustiveness) {
      case "full_object_test": {
        return (candidate) =>
          (before === undefined || candidate.id < before) &&
          (after === undefined || (afterInclusivity === "inclusive" ? candidate.id >= after : candidate.id > after));
      }
      case "full_database_test": {
        const clauses: Array<SQL<unknown>> = [];
        if (before !== undefined) {
          switch (beforeInclusivity) {
            case "exclusive": {
              clauses.push(lt($containerEvent.id, Uuid.toBytes(before)));
              break;
            }
            default: {
              beforeInclusivity satisfies undefined | never;
            }
          }
        }
        if (after !== undefined) {
          switch (afterInclusivity) {
            case "inclusive": {
              clauses.push(gte($containerEvent.id, Uuid.toBytes(after)));
              break;
            }
            case "exclusive": {
              clauses.push(gt($containerEvent.id, Uuid.toBytes(after)));
              break;
            }
            default: {
              afterInclusivity satisfies undefined | never;
            }
          }
        }
        return () => clauses;
      }
    }
  }

  function asciiLower(value: string): string {
    return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
  }

  function sqlSubstring(needle: string): SQL<unknown> {
    const escaped = needle.replace(/[\\%_]/g, (character) => `\\${character}`);
    return sql`${$containerEvent.line} like ${`%${escaped}%`} escape '\\'`;
  }
}
