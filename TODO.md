# 1) Redesign the container "identity" mechanism

- By default, container "identity" should be based on "container name" ... will lead to changes like the frontend URL containing our own minted ID, rather than the real docker container ID
- This probably means that our "container" domain object requires an abstraction like `ContainerChain` or something, since we'll want to track containers across ID changes, as long as they retain their names
- I think this has a consequence that's already important to record: which specific container belongs to which specific log line (we already kind-of do that), but the current `Container` object becomes more of an intermediate object, wereas `ContainerChain` will be the user-facing model
- In the (far) future, but not now, when adding better Docker Swarm/Stack support, we might want to interleave the log output of multiple Swarm replicas of the same service; filterable on a per-container basis, if wanted

## 2) Invent history for the slow "trickle" container

- So that on `bun dev`, it automatically invents history for the last 3 days up until now (the automatic retention cleanup might bite, tho)
- This will give a nice combination of all sorts of events (started, container started / stopped, throttle, day transitions, etc.)
- I'll use this to manually finetune the layout, to see what makes sense
- Finalize the logs page

### 3) UI/UX (re)design the other 2 pages

- The homepage listing should show all running containers instead, and any stopped containers should be hidden by default
- Design a configuration page, with sections for "global conf" (alert endpoints, default alert pattern, default alert volume throughput-values, throttle value, retention) and "per-container-conf" (alert regexes/throughput-values and endpoint refs, individual throttle values, individual retention values)
- CHALLENGE: per-container labels only exists while the containers are running ... what if the labels change from 1 container to the next? Latest wins? What if we're in the Swarm/Stack future and multiple replicas are running in the same chain? what if their labels disagree?

#### 4) Build the configuration framework

- All config must be passed via env vars to the Dolog process, or as `ing.butterhost.dolog.XXX` labels on individual containers
- Temporarily, settings can be configured and applied on the configuration page, but with a big fat warning label that they will be wiped on restart (no config in the database)

##### 5) Build the alert notification webhook mechanism

- Endpoints only, no scripts
- Using standard webhook best practices, like HMAC signature headers

###### 6) Finish up

- Write unit and E2E tests
- Fix TODOs (timezone considerations, etc.)
- Setup a pipeline to release a Dolog docker image
- Add a new entry on the main website
- Begin using it myself
- Release it
