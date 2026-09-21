# TESTS FOR THE OVERVIEW PAGE

- does the summary at the top show 4 running containers? does it show cpu + memory stats? (actual values dont matter, as long as there are some numbers there)
- does it show 4 containers (running) container cards
- temporarily start+stop a docker container which logs something -> update preferences to show stopped services -> expect to see that stopped container card in the overview as well now

# TESTS FOR CONFIGURATION PAGE

- the compose.deps and .env.e2e and Env.Defaults are unlikely to change, so can you assert some of the values are present there under the right sections? if the defaults ever change, this test is allowed to fail imo, so no problem

# TESTS FOR A THE "trickle" LOGS PAGE

- is the correct title shown? "dolog / trickle .. and alpine:latest"
- are cpu/memory stats shown? (don't care about actual values, as long as there are some percentages and values)
- can the text size be changed (S/M/L)?

- are log lines getting appended? (should be plenty coming in, i cranked it up to 5 logs/s)
- if you scroll up, does the appending pause, and do you get that arrow to take you to reconnect to the livestream in the bottom-right corner? and if you click it, does it disappear, and are logs getting appended again?
- if you scroll up, and click a line, and refresh, is the clicked line still pinned? if you click it again and reload, are we back at the livestream?

- can you click the Navigate button, and go to yesterday? can you confirm this places you at the start of the log stream? (implicitly assuming that before the e2e tests start, we clear the sqlite database, just like visage does) - and again, does reloading keep that position, but then if you click it (to dispose) and reload again, will it take you back to the livestream?

- can you click the Search button, and search for "health" and does it highlight all "health" matches? can you use the up-arrow to navigate until you're disconnected from the livestream?
- can you use escape (or click "search" again) to dismiss the searches and the dialog box?

- can the period be changed to "last 5m" or "today" -- verify if this shows the correct url afterwards (before resetting back to the default of last 30d)

- can you filter on "health" and verify that all visible matches contain the string health? and the clear the search and verify things are normal again?

# TESTS FOR WEBHOOKS

- in the current configuration, i'd expect 2 webhook notifications immediately: one for textpattern matching, and one for breaching the throughput threshold: can you verify both webhooks have been delivered to the webhooks container?
- to do this: i think you should expose the webhooks container port on 3001, and give it an endpoint which returns all the webhooks it has received since starting, in json ... then this e2e test can assert on that
