create table container (
    id integer primary key,
    did text not null unique,
    dname text not null,
    dgroup text
);
