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
    id integer primary key,
    container integer not null references container(id) on delete cascade,
    timestamp text not null,
    type text not null,
    stream_variant text,
    line text,
    fold_count integer
);
--> statement-breakpoint
create index container_event_container_idx on container_event (container, id);
