export function DesignerPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Designer</h1>
      <p className="text-sm text-muted-foreground">
        Drop an XML / YAML file → schema tree → generated form. Ported from InfraKit&apos;s FormFlow
        in F1 / F4.
      </p>
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        File drop + form designer land in F4.
      </div>
    </div>
  )
}
