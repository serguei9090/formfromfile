/** Starter files for the empty-state gallery — loaded into the designer, not saved. */
export interface Sample {
  id: string
  name: string
  kind: string
  blurb: string
  body: string
}

export const SAMPLES: Sample[] = [
  {
    id: 'k8s-yaml',
    name: 'Kubernetes Deployment (YAML)',
    kind: 'YAML',
    blurb: 'Comments and key order are preserved on export.',
    body: `# edit replicas / image, keep everything else
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 2          # scale here
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80
`,
  },
  {
    id: 'dotenv',
    name: 'Service .env',
    kind: '.env',
    blurb: 'Flat KEY=value with validation presets (URL, port, …).',
    body: `# database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=app

# app
LOG_LEVEL=info
PORT=8080
FEATURE_SIGNUP=true
`,
  },
  {
    id: 'pyproject',
    name: 'pyproject.toml',
    kind: 'TOML',
    blurb: 'Nested tables round-trip through the TOML plugin.',
    body: `[project]
name = "myapp"
version = "0.1.0"
requires-python = ">=3.11"

[project.optional-dependencies]
dev = ["pytest", "ruff"]

[tool.ruff]
line-length = 100
`,
  },
]

const BY_ID = new Map(SAMPLES.map((s) => [s.id, s]))
export const sampleById = (id: string | null | undefined) => (id ? BY_ID.get(id) : undefined)
