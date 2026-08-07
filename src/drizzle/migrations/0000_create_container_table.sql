create table container (
    id integer primary key,
    docker_id text not null unique,
    name text not null,
    group_name text,
    first_seen text not null,
    last_seen text not null
);
