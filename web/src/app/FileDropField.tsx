import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface FileDropFieldProps {
  value: string
  onChange: (text: string) => void
  accept?: string
  placeholder?: string
  rows?: number
}

/**
 * A textarea that also accepts a dropped / chosen file: reads it as UTF-8
 * text into `value` and shows the filename until the text is edited by hand.
 */
export function FileDropField({ value, onChange, accept, placeholder, rows = 10 }: FileDropFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)

  async function readFile(file: File) {
    const text = await file.text()
    setFileName(file.name)
    onChange(text)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <FileUp className="size-4" /> Choose file…
        </Button>
        {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void readFile(f)
            e.target.value = ''
          }}
        />
      </div>
      <Textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          if (fileName) setFileName('')
          onChange(e.target.value)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void readFile(f)
        }}
        className={cn('font-mono text-xs', dragging && 'ring-2 ring-primary')}
      />
    </div>
  )
}
