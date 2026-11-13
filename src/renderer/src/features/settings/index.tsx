import { useEffect, useState, type ReactNode } from 'react'
import type { SystemInfo } from '@shared/api'
import { Button, ErrorBoundary, Field, Icon, Input, Logo, QRCode, SegmentedControl, Toggle, promptText, toast } from '@ui/index'
import { defineFeature } from '../../app/feature'
import { allSettings } from '../../app/registry'
import { api, useApp } from '../../app/store'
import { lockForVolunteers } from '../../app/lock'
import './settings.css'

function Section({ id, title, children, intro }: { id: string; title: string; intro?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section className="set-section" id={`settings-${id}`} data-testid={`settings-${id}`}>
      <h2 className="set-title">{title}</h2>
      {intro && <p className="set-intro">{intro}</p>}
      <div className="set-card">{children}</div>
    </section>
  )
}

function GeneralSettings({ info }: { info: SystemInfo | null }): ReactNode {
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const workspace = useApp((s) => s.workspace)
  const [path, setPath] = useState<string>('')
  useEffect(() => { void api.invoke('local.get', { key: 'workspacePath' }).then((v) => setPath(typeof v === 'string' ? v : '')).catch(() => {}) }, [])

  const chooseFolder = async (): Promise<void> => {
    const [dir] = await api.invoke('system.pickFiles', { title: 'Choose the workspace folder', directory: true }).catch(() => [] as string[])
    if (!dir) return
    await api.invoke('local.set', { key: 'workspacePath', value: dir })
    setPath(dir)
    toast('Workspace folder changed', 'success', 'Restart Reach Presenter to open it.')
  }
  const setPin = async (): Promise<void> => {
    const pin = await promptText({ title: prefs.volunteerPin ? 'Change the PIN' : 'Set a PIN', message: 'Needed to leave Volunteer mode on this computer. Leave empty for no PIN.', label: 'PIN (numbers are easiest)', password: true, confirmLabel: 'Save PIN', validate: (v) => (v && v.length < 4 ? 'Use at least 4 characters.' : null) })
    if (pin === null) return
    setPrefs({ volunteerPin: pin })
    toast(pin ? 'PIN saved' : 'PIN removed', 'success')
  }

  return (
    <>
      <Section id="workspace" title="Workspace" intro="Songs, services and media live in one folder. Put it in iCloud Drive, Dropbox or a shared drive to use the same library on several computers.">
        <Field inline label={workspace?.name ?? 'Workspace'} hint={<span className="t-meta">{info?.workspacePath ?? path ?? '…'}</span>}>
          <div className="row">
            <Button size="sm" icon="folder" onClick={() => info && void api.invoke('system.openPath', { path: info.workspacePath })}>Show folder</Button>
            <Button size="sm" onClick={() => void chooseFolder()}>Change…</Button>
          </div>
        </Field>
      </Section>

      <Section id="volunteer" title="Volunteer mode" intro="Hides editing, deleting and settings so a first-time volunteer can only run the service. Turn it on before handing over the computer.">
        <Field inline label="Volunteer mode" hint="The lock at the top right of the window does the same thing.">
          <Button size="sm" icon="lock" data-testid="settings-lock" onClick={lockForVolunteers}>Turn on now</Button>
        </Field>
        <Field inline label="Unlock PIN" hint={prefs.volunteerPin ? 'A PIN is set on this computer.' : 'No PIN — anyone can switch back to full mode.'}>
          <Button size="sm" onClick={() => void setPin()}>{prefs.volunteerPin ? 'Change PIN' : 'Set PIN'}</Button>
        </Field>
        <Field inline label="Carry on into the next item" hint="Pressing Next on the last slide starts the next song in the service.">
          <Toggle checked={prefs.autoContinue} onChange={(v) => setPrefs({ autoContinue: v })} aria-label="Carry on into the next item" />
        </Field>
      </Section>

      <RemoteAccess info={info} />

      <Section id="appearance" title="Appearance">
        <Field inline label="Size of everything" hint="Make the app bigger on a small laptop or a high-up booth screen.">
          <SegmentedControl aria-label="UI scale" value={prefs.scale} onChange={(scale) => setPrefs({ scale })}
            options={[{ value: 0.9, label: 'Small' }, { value: 1, label: 'Normal' }, { value: 1.15, label: 'Large' }, { value: 1.3, label: 'Larger' }]} />
        </Field>
        <Field inline label="Welcome guide" hint="Walk through first-time setup again.">
          <Button size="sm" onClick={() => { setPrefs({ onboarded: false }); useApp.getState().setOverlay('welcome') }}>Show again</Button>
        </Field>
      </Section>
    </>
  )
}

function RemoteAccess({ info }: { info: SystemInfo | null }): ReactNode {
  const [pin, setPin] = useState<string>('')
  const [show, setShow] = useState(false)
  useEffect(() => { void api.invoke('local.get', { key: 'remotePin' }).then((v) => setPin(typeof v === 'string' ? v : '')).catch(() => {}) }, [])
  const urls = info?.serverUrls ?? []
  const main = urls.find((u) => !/localhost|127\.0\.0\.1/.test(u)) ?? urls[0]
  return (
    <Section id="remote" title="Phones, tablets and other screens" intro="Any phone, tablet, TV or computer on the same Wi-Fi can open this address — as a remote, a stage display, or an extra screen.">
      <div className="remote">
        {main ? <QRCode value={main} size={132} /> : <div className="remote-qr-empty"><Icon name="wifi" size={28} /></div>}
        <div className="col grow" style={{ gap: 12 }}>
          <Field label="Address">
            <div className="row">
              <Input readOnly className="mono grow" value={main ?? 'Starting…'} data-testid="remote-url" onFocus={(e) => e.target.select()} />
              <Button size="sm" icon="copy" disabled={!main} onClick={() => { void navigator.clipboard?.writeText(main!); toast('Address copied', 'success') }}>Copy</Button>
            </div>
          </Field>
          {urls.length > 1 && <div className="t-meta">Also: {urls.filter((u) => u !== main).join(' · ')}</div>}
          <Field label="PIN for remote control" hint="Screens only show slides. Controlling the show from a phone needs this PIN.">
            <div className="row">
              <Input readOnly className="mono" style={{ width: 130, letterSpacing: '.2em' }} value={pin ? (show ? pin : '••••••') : 'not set yet'} />
              {pin && <Button size="sm" variant="ghost" icon={show ? 'eyeOff' : 'eye'} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</Button>}
            </div>
          </Field>
        </div>
      </div>
    </Section>
  )
}

/** Settings: general (this file) + one section per feature from `defineFeature({ settings })`. */
function SettingsView(): ReactNode {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  useEffect(() => { void api.invoke('system.info').then(setInfo).catch(() => {}) }, [])
  const sections = allSettings()
  const nav = [
    { id: 'workspace', title: 'Workspace' }, { id: 'volunteer', title: 'Volunteer mode' }, { id: 'remote', title: 'Phones & screens' }, { id: 'appearance', title: 'Appearance' },
    ...sections.map((s) => ({ id: s.id, title: s.title }))
  ]
  const [active, setActive] = useState(nav[0].id)
  return (
    <div className="settings" data-testid="settings-view">
      <nav className="set-nav" aria-label="Settings sections">
        <h1 className="set-h1">Settings</h1>
        {nav.map((n) => (
          <button key={n.id} type="button" className={`set-nav-item ${active === n.id ? 'on' : ''}`} onClick={() => { setActive(n.id); document.getElementById(`settings-${n.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{n.title}</button>
        ))}
        <div className="grow" />
        <button type="button" className="set-about" onClick={() => useApp.getState().setOverlay('about')}>
          <Logo variant="icon" height={22} /><span><span className="t-label">Reach Presenter</span><span className="t-meta">Version {info?.version ?? '…'}</span></span>
        </button>
      </nav>
      <div className="set-body scroll" onScroll={(e) => {
        const top = (e.currentTarget as HTMLElement).getBoundingClientRect().top
        const hit = nav.findLast((n) => (document.getElementById(`settings-${n.id}`)?.getBoundingClientRect().top ?? 1e9) - top < 120)
        if (hit && hit.id !== active) setActive(hit.id)
      }}>
        <div className="set-inner">
          <GeneralSettings info={info} />
          {sections.map((s) => (
            <section key={s.id} className="set-section" id={`settings-${s.id}`}>
              <h2 className="set-title">{s.title}</h2>
              <div className="set-card"><ErrorBoundary name={s.title} compact><s.component /></ErrorBoundary></div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

export default defineFeature({
  id: 'settings',
  views: [{ id: 'settings', title: 'Settings', order: 90, component: SettingsView }]
})
