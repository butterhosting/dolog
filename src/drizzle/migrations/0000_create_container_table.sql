create table container (
    id integer primary key,
    did text not null unique,
    dname text not null,
    dgroup text,
    dimage text not null,
    dlabels text not null, -- JSON object
    last_activity text not null
);
