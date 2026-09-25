import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import {
  getMessageThreads,
  getMessagesForCaregiver,
  getCaregiver,
  markThreadReadByOffice,
  getOrganization,
} from '@/lib/queries';
import { formatMessageTime } from '@/lib/format-time';
import OfficeMessageComposer from '@/components/admin/OfficeMessageComposer';

// Office inbox: every caregiver conversation on the left, the open one on
// the right. Opening a thread marks the caregiver's messages read. A
// location admin sees only their location's caregivers.
export default async function OfficeMessagesPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const params = await searchParams;
  const locationId = session.locationId || null;
  const showAll = params?.all === '1';

  const threads = await getMessageThreads(session.organizationId, { locationId, includeEmpty: showAll });
  const selectedId = typeof params?.c === 'string' ? params.c : threads[0]?.caregiverId;
  const caregiver = selectedId ? await getCaregiver(session.organizationId, selectedId, locationId) : null;
  if (caregiver) await markThreadReadByOffice(session.organizationId, caregiver.id, locationId);
  const [messages, organization] = await Promise.all([
    caregiver ? getMessagesForCaregiver(session.organizationId, caregiver.id) : [],
    getOrganization(session.organizationId),
  ]);

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="font-display font-extrabold text-[24px]">Messages</h1>
          <p className="text-[13.5px] text-[var(--muted)] mt-1">Conversations between the office and caregivers.</p>
        </div>
        <Link
          href={showAll ? '/admin/messages' : '/admin/messages?all=1'}
          className="text-[12.5px] font-display font-bold text-[var(--accent)]"
        >
          {showAll ? 'Only conversations' : 'New message to any caregiver'}
        </Link>
      </div>

      <div className="grid md:grid-cols-[300px_1fr] bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden min-h-[560px]">
        <aside className="border-r border-[var(--border)] overflow-y-auto max-h-[70vh]">
          {threads.length === 0 && (
            <p className="text-[12.5px] text-[var(--muted)] p-5">
              No conversations yet.{' '}
              <Link href="/admin/messages?all=1" className="text-[var(--accent)] font-display font-bold">
                Start one
              </Link>
              .
            </p>
          )}
          {threads.map((t) => {
            const active = caregiver?.id === t.caregiverId;
            return (
              <Link
                key={t.caregiverId}
                href={`/admin/messages?c=${encodeURIComponent(t.caregiverId)}${showAll ? '&all=1' : ''}`}
                className={
                  'block px-4 py-3 border-b border-[var(--border)] ' + (active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[oklch(97%_0.006_85)]')
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={'text-[13.5px] truncate ' + (t.unread && !active ? 'font-display font-extrabold' : 'font-display font-bold')}>
                    {t.name}
                  </span>
                  <span className="text-[11px] text-[var(--muted)] shrink-0">{t.lastAt ? formatMessageTime(t.lastAt) : ''}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-[12px] text-[var(--muted)] truncate">
                    {t.lastBody ? `${t.lastMine ? '' : 'Office: '}${t.lastBody}` : 'No messages yet'}
                  </span>
                  {t.unread > 0 && !active && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--accent-strong)] text-white text-[10.5px] font-extrabold flex items-center justify-center shrink-0">
                      {t.unread}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </aside>

        <section className="flex flex-col min-h-[560px]">
          {caregiver ? (
            <>
              <header className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-3">
                <div>
                  <div className="font-display font-extrabold text-[15px]">{caregiver.name}</div>
                  <div className="text-[12px] text-[var(--muted)]">
                    {caregiver.role} · {caregiver.phone || 'no phone'} · {caregiver.status}
                  </div>
                </div>
                <Link href={`/admin/caregivers/${encodeURIComponent(caregiver.id)}`} className="text-[12px] font-display font-bold text-[var(--accent)]">
                  Profile
                </Link>
              </header>
              <div className="flex-1 overflow-y-auto max-h-[52vh] px-5 py-4 flex flex-col gap-3">
                {messages.length === 0 && <p className="text-[12.5px] text-[var(--muted)]">No messages yet — say hello below.</p>}
                {messages.map((m) => (
                  <div key={m.id} className={'flex flex-col ' + (m.mine ? 'items-start' : 'items-end')}>
                    <span className="text-[10.5px] font-display font-bold text-[var(--muted)] mb-0.5 px-1">
                      {m.sender}
                      {m.source === 'sms' ? ' · by text' : ''}
                    </span>
                    <div
                      className={
                        'max-w-[75%] rounded-[16px] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words ' +
                        (m.mine
                          ? 'bg-[oklch(96%_0.006_85)] border border-[var(--border)] rounded-bl-[4px]'
                          : 'bg-[var(--accent-strong)] text-white rounded-br-[4px]')
                      }
                    >
                      {m.text}
                    </div>
                    <span className="text-[10.5px] text-[var(--muted)] mt-1 px-1">
                      {formatMessageTime(m.createdAt)}
                      {!m.mine && m.readByCaregiverAt ? ' · Seen' : ''}
                    </span>
                  </div>
                ))}
              </div>
              <OfficeMessageComposer
                caregiverId={caregiver.id}
                caregiverName={caregiver.name.split(' ')[0]}
                notifyChannel={organization?.caregiverNotifyChannel || 'sms'}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--muted)]">Pick a conversation.</div>
          )}
        </section>
      </div>
    </div>
  );
}
