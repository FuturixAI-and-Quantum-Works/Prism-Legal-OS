import FileTypeIcon from '../../components/FileTypeIcon'
import { UploadIcon } from '../../components/icons'
import type { WorkspaceComplianceFile } from './complianceModels'
import { complianceFontFamily } from './compliancePresentation'

interface WorkspaceDocumentsPanelProps {
  workspaceName: string
  files: WorkspaceComplianceFile[]
}

export function WorkspaceDocumentsPanel({ workspaceName, files }: WorkspaceDocumentsPanelProps) {
  return (
    <section
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
      }}
    >
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #EDEDED',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
        }}
      >
        <UploadIcon size={90} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 590,
              color: '#272727',
              letterSpacing: '-0.9px',
              lineHeight: '22px',
              fontFamily: complianceFontFamily,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {workspaceName}
          </p>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '13px',
              color: '#797979',
              letterSpacing: '-0.3px',
              lineHeight: '16px',
              fontFamily: complianceFontFamily,
            }}
          >
            {files.length} document{files.length !== 1 ? 's' : ''} selected for review
          </p>
        </div>
      </div>

      <div style={{ flex: 1, padding: '12px 16px', overflowY: 'auto' }}>
        {files.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: '#797979',
              fontSize: '14px',
              fontFamily: complianceFontFamily,
            }}
          >
            No documents in this project
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {files.map((file) => (
              <div
                key={file.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  backgroundColor: '#F9F9F9',
                  borderRadius: '8px',
                  border: '1px solid #EDEDED',
                }}
              >
                <span
                  style={{
                    width: '32px',
                    height: '32px',
                    backgroundColor: '#F5F5F5',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FileTypeIcon filename={file.name} />
                </span>
                <p
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    fontWeight: 510,
                    color: '#454545',
                    letterSpacing: '-0.7px',
                    lineHeight: '18px',
                    fontFamily: complianceFontFamily,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.name}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
