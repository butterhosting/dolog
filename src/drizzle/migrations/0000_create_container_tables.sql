create table container (
    id integer primary key,
    docker_id text not null unique,
    name text not null,
    group_name text,
    first_seen text not null,
    last_seen text not null
);
--> statement-breakpoint
create table container_event (
    -- uuidv7, stored as its sixteen raw bytes. Minted when the event is created rather than when
    -- it is stored, so a line that has only just arrived over the socket can already be pointed at.
    -- Time-ordered, and memcmp on those bytes preserves that, so it doubles as the sort and pruning
    -- key the way a rowid would.
    id blob primary key,
    container integer not null references container(id) on delete cascade,
    timestamp text not null,
    type text not null,
    stream_variant text,
    line text,
    fold_count integer
)
-- the id is the key, so `without rowid` stores it once instead of alongside a rowid it would never
-- be looked up by. Measured on 15k typical log rows: 4.11 MB for an integer rowid, 6.01 MB for a
-- text uuid keeping one, 5.24 MB for text without, and 4.58 MB here.
without rowid;
--> statement-breakpoint
create index container_event_container_idx on container_event (container, id);
