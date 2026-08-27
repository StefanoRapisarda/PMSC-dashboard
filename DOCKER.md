# Running the whole thing in Docker

This is written for somebody who has not used Docker before. It explains what
each command does as well as what to type. Everything happens in this directory,
`Showcases/dashboard`.

## What a container is, in one paragraph

Docker packages an application together with the operating system pieces it
needs, so that it runs the same way on any machine. The package is called an
**image**, and it is built once from the recipe in `Dockerfile`. A running copy
of an image is called a **container**. You can start, stop and throw away
containers freely; the image they came from is unaffected. Nothing about this
touches the Python or Node you have installed, and deleting the image leaves no
trace on your machine.

## Before you start

Docker Desktop must be running. There is no daemon to configure; it is enough
that the whale icon is in the menu bar. If you are not sure, run this:

```
docker info
```

If it prints several lines about the server, you are ready. If it says it cannot
connect to the Docker daemon, open Docker Desktop from Applications and wait
half a minute.

## Step one: build the image

```
docker build -t pmsc:latest .
```

`-t pmsc:latest` gives the image a name, so that you can refer to it later
without remembering a long identifier. The full stop at the end is the build
context: the directory Docker sends to the build engine, which is why
`.dockerignore` matters.

The first build takes a few minutes, mostly downloading Node and Python. It
prints one block per instruction in the `Dockerfile`. Later builds are much
faster, because Docker reuses everything above the first line that changed.

At the end you should see `naming to docker.io/library/pmsc:latest`.

## Step two: run it

```
docker run -d --name pmsc -p 8080:8000 pmsc:latest
```

| Part | What it does |
|---|---|
| `-d` | Detached. The container runs in the background and gives you your terminal back. |
| `--name pmsc` | A name to refer to it by, instead of a random one like `dreamy_hopper`. |
| `-p 8080:8000` | Publishes the container's port 8000 as port 8080 on your machine. The left number is yours to choose; the right one is fixed by the application. |
| `pmsc:latest` | Which image to run. |

Then open <http://localhost:8080> in a browser.

## Step three: check it is well

```
docker ps
```

This lists running containers. Look at the `STATUS` column: after a few seconds
it should say `Up ... (healthy)`. That word comes from the `HEALTHCHECK` in the
`Dockerfile`, which asks the application whether it can still read its database
rather than merely checking that a process exists.

To see what the application is printing:

```
docker logs -f pmsc
```

Press Control-C to stop watching. That does not stop the container.

## Step four: stop and clean up

```
docker stop pmsc
docker rm pmsc
```

`stop` ends the running container; `rm` deletes it. The image stays, so starting
again is instant. To remove the image as well:

```
docker rmi pmsc:latest
```

## When you change the code

Rebuild and restart:

```
docker stop pmsc && docker rm pmsc
docker build -t pmsc:latest .
docker run -d --name pmsc -p 8080:8000 pmsc:latest
```

This is not how to develop day to day. For that, keep running the API and Vite
directly, which reload as you save. The container is for handing the application
to somebody else, or for putting it on a server.

## What is inside the image

The build has two stages. The first uses Node to compile the Svelte application
into plain files. The second starts from Python, installs the API's
dependencies, generates the synthetic cohort from the tracked data dictionary,
builds the database from it, and copies in the compiled files from the first
stage. Node is not present in the finished image at all; only its output is.

The finished image is about 420 MB and needs no network, no database server and
no configuration.

## Two things that surprised us, which are worth knowing

**One port, not two.** In development the API runs on 8000 and the web
application on 5173, and the browser talks across the two. In the container both
come from the same address, which removes a whole class of cross-origin
problems. That works because the front end reads its API address from
`VITE_API_BASE`, and the `Dockerfile` sets it to empty so that every request
becomes a relative one.

**`npm ci` does not work here, and that is correct behaviour.** `npm ci`
installs exactly what `package-lock.json` names and refuses to do anything else.
A lock file records the platform-specific binaries for the machine that produced
it, and ours was produced on a Mac, so it contains no Linux build of Rollup. The
`Dockerfile` therefore uses `npm install`, which still takes every version
number from the lock file and additionally resolves the few packages that can
only be chosen once the platform is known.

## If something goes wrong

| What you see | What it usually means |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop is not running. |
| `port is already allocated` | Something else is on port 8080. Use `-p 8081:8000` instead. |
| `Up ... (unhealthy)` | The application started but cannot read its database. `docker logs pmsc` will say why. |
| The page loads but every number is missing | The API is not answering. Check `curl http://localhost:8080/healthz`. |
| The build stops in the middle | Read the last block printed. Docker names the failing instruction and the line number in the `Dockerfile`. |
