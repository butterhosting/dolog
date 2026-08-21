create table container_event (
    id blob primary key, -- UUIDv7
    container_id integer not null references container(id) on delete cascade,
    timestamp text not null,
    type text not null,
    stream_variant text,
    line text,
    drop_count integer
)
without rowid;
--> statement-breakpoint
create index container_event_container_idx on container_event (container_id, id);
