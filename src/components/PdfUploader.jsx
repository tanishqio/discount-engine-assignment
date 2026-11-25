/**
 * PdfUploader.jsx
 *
 * Upload area for a cart PDF. Looks like CsvUploader, but passes the File itself
 * to onFile(file), because pdf.js needs the raw bytes, not text.
 */

import { useRef } from 'react'

export default function PdfUploader({ onFile, loading, fileName }) {
  const inputRef = useRef(null)
  const hasData = Boolean(fileName)

  function handleFile(e) {
    const file = e.target.files[0]
    e.target.value = '' // reset so the same file can be picked again
    if (file) onFile(file)
  }

  return (
    <div
      style={{
        border: `2px dashed ${hasData ? '#1e5c2c' : '#CECECE'}`,
        borderRadius: 6,
        padding: '1rem 1.2rem',
        marginTop: '0.6rem',
        background: hasData ? '#f0faf2' : '#fafafa',
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1,
      }}
      onClick={() => {
        if (!loading) inputRef.current?.click()
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: 20 }}>{hasData ? '✅' : '📄'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48' }}>cart.pdf</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
            {loading ? 'Reading PDF...' : hasData ? fileName : 'Upload cart PDF (Product, Brand, Platform, Base Price)'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: hasData ? '#1e5c2c' : '#FF5800',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {loading ? 'Wait' : hasData ? 'Change' : 'Upload'}
          </span>
        </div>
      </div>
    </div>
  )
}
