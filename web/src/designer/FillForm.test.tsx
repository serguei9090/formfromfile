import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { FormTemplate } from '@/formflow_ext/templateModel'
import { FillForm } from './FillForm'

const template: FormTemplate = {
  schema: {
    format: 'json',
    rootName: 'root',
    fields: [
      { key: 'Host', type: 'text', children: [] },
      { key: 'Note', type: 'text', children: [] },
    ],
  },
  meta: {
    Host: { label: 'Host', required: true, preset: 'ipv4' },
    Note: { editable: false },
  },
  tokens: [],
  formatId: 'json',
}

const setup = () =>
  render(
    <FillForm template={template} source="" initialValues={{ Host: '', Note: 'internal' }} />,
  )

describe('FillForm', () => {
  it('keeps Export disabled until the form is valid, then exports', async () => {
    setup()
    const exportBtn = () => screen.getByRole('button', { name: /export/i })

    await waitFor(() => expect(exportBtn()).toBeDisabled())

    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'nope' } })
    await waitFor(() => expect(screen.getByText(/valid IPv4/i)).toBeInTheDocument())
    expect(exportBtn()).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: '10.0.0.5' } })
    await waitFor(() => expect(exportBtn()).toBeEnabled())

    fireEvent.click(exportBtn())
    await waitFor(() => expect(screen.getByText(/"Host": "10.0.0.5"/)).toBeInTheDocument())
    // locked field still emitted
    expect(screen.getByText(/"Note": "internal"/)).toBeInTheDocument()
  })

  it('does not render locked fields', () => {
    setup()
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()
  })
})
