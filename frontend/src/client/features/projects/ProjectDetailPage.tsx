import { useParams } from 'react-router-dom'
import { useGetProjectQuery } from './projectsApi'

const fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", Roboto, sans-serif'

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const {
    data: project,
    isLoading,
    isError,
  } = useGetProjectQuery(projectId, {
    skip: !projectId,
  })

  return (
    <section
      aria-labelledby="project-title"
      style={{
        flex: 1,
        padding: '32px',
        backgroundColor: '#F5F5F5',
        fontFamily,
      }}
    >
      {isLoading ? (
        <p role="status" style={{ margin: 0, color: '#797979' }}>
          Loading project...
        </p>
      ) : isError || !project ? (
        <div role="alert">
          <h1 id="project-title" style={{ margin: 0, fontSize: '24px', color: '#272727' }}>
            Project unavailable
          </h1>
          <p style={{ color: '#797979' }}>This project could not be loaded.</p>
        </div>
      ) : (
        <>
          <div
            style={{
              padding: '24px',
              border: '1px solid #EDEDED',
              borderRadius: '12px',
              backgroundColor: '#FFFFFF',
            }}
          >
            <p
              style={{
                margin: '0 0 8px',
                color: '#797979',
                fontSize: '13px',
                textTransform: 'uppercase',
              }}
            >
              Project
            </p>
            <h1 id="project-title" style={{ margin: 0, fontSize: '28px', color: '#272727' }}>
              {project.name}
            </h1>
            {project.cmNumber && (
              <p style={{ margin: '8px 0 0', color: '#616161' }}>Matter {project.cmNumber}</p>
            )}
          </div>
          <dl
            aria-label="Project summary"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '12px',
              margin: '16px 0 0',
            }}
          >
            {[
              ['Access', project.role.charAt(0).toUpperCase() + project.role.slice(1)],
              ['Folders', project.folders.length],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  padding: '16px',
                  border: '1px solid #EDEDED',
                  borderRadius: '10px',
                  backgroundColor: '#FFFFFF',
                }}
              >
                <dt style={{ color: '#797979', fontSize: '13px' }}>{label}</dt>
                <dd style={{ margin: '6px 0 0', color: '#272727', fontSize: '22px' }}>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
