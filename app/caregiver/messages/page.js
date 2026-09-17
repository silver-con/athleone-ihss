import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getMessagesForCaregiver } from '@/lib/queries';
import MessageComposer from '@/components/caregiver/MessageComposer';

export default async function CaregiverMessagesPage() {
  const session = await getSession();
  if (!session?.caregiverId) redirect('/login');

  const thread = await getMessagesForCaregiver(session.organizationId, session.caregiverId);

  return (
    <div className="flex flex-col h-full">
      <h1 className="font-display font-extrabold text-[19px]">Messages</h1>
      <p className="text-[12.5px] text-[var(--muted)] mt-0.5 mb-4">The office · Hearth Home Care</p>

      <div className="flex-1 flex flex-col gap-3">
        {thread.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">No messages yet.</p>
        ) : (
          thread.map((m) => (
            <div key={m.id} className={'flex flex-col ' + (m.mine ? 'items-end' : 'items-start')}>
              {!m.mine && (
                <span className="text-[10.5px] font-display font-bold text-[var(--muted)] mb-0.5 px-1">
                  {m.sender}
                </span>
              )}
              <div
                className={
                  'max-w-[85%] rounded-[16px] px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                  (m.mine
                    ? 'bg-[var(--accent-strong)] text-white rounded-br-[4px]'
                    : 'bg-[var(--surface)] border border-[var(--border)] rounded-bl-[4px]')
                }
              >
                {m.text}
              </div>
              <span className="text-[10.5px] text-[var(--muted)] mt-1 px-1">{m.time}</span>
            </div>
          ))
        )}
      </div>

      <MessageComposer />
    </div>
  );
}
