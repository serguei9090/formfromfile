import { Link } from 'react-router'
import { FileUp } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Forms</h1>
        <p className="text-sm text-muted-foreground">
          Upload an XML or YAML file, get a form, fill it, export the result.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="size-4 text-primary" /> New form from a file
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            The designer auto-detects the schema, including repeating / dynamic-array sections.
          </p>
          <Link to="/designer" className={buttonVariants()}>
            Open the designer
          </Link>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        No saved forms yet — server-backed list lands in F3.
      </p>
    </div>
  )
}
