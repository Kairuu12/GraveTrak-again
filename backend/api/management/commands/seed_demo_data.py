from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import Application, ColumbariumSlot, UserProfile


class Command(BaseCommand):
    help = 'Explicitly create the standard GraveTrak development demo data.'

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('Demo data can only be seeded when DEBUG=True.')

        User = get_user_model()
        seeded_user_count = 0

        demo_users = [
            {
                'username': 'officeofmayors',
                'email': 'cmayor@gmail.com',
                'password': 'mayorsoffice',
                'first_name': 'Office of',
                'last_name': 'Mayors',
                'role': 'mayor',
                'superuser': True,
            },
            {
                'username': 'cpdo',
                'email': 'cplanning@gmail.com',
                'password': 'cityplanning',
                'first_name': 'City',
                'last_name': 'Planner',
                'role': 'planning',
            },
            {
                'username': 'cemetery_staff',
                'email': 'cstaff@gmail.com',
                'password': 'cemeterystaff',
                'first_name': 'Cemetery',
                'last_name': 'Staff',
                'role': 'staff',
            },
        ]

        for demo_user in demo_users:
            user_data = {key: value for key, value in demo_user.items() if key not in ('role', 'superuser')}
            user = User.objects.filter(username=demo_user['username']).first()
            if user is None:
                if demo_user.get('superuser'):
                    user = User.objects.create_superuser(**user_data)
                else:
                    user = User.objects.create_user(**user_data)
                seeded_user_count += 1
            UserProfile.objects.get_or_create(user=user, defaults={'role': demo_user['role']})

        if not ColumbariumSlot.objects.exists():
            slots = []
            for section in (f'Section {letter}' for letter in 'ABCDEFGHIJKLMN'):
                for floor in range(1, 5):
                    for column in range(1, 85):
                        slots.append(ColumbariumSlot(
                            id=f'{section}-old-F{floor}-C{column}',
                            section=section,
                            floor=floor,
                            col=column,
                            cemetery_map='old',
                            status='available',
                            name='',
                        ))

            for section in ('Section A', 'Section B'):
                for floor in range(1, 5):
                    for column in range(1, 133):
                        slots.append(ColumbariumSlot(
                            id=f'{section}-new-F{floor}-C{column}',
                            section=section,
                            floor=floor,
                            col=column,
                            cemetery_map='new',
                            status='available',
                            name='',
                        ))

            ColumbariumSlot.objects.bulk_create(slots, batch_size=1000)
            seeded_slot_count = len(slots)
        else:
            seeded_slot_count = 0

        _, application_created = Application.objects.get_or_create(
            id='BUR-DEMO-001',
            defaults={
                'name': 'Sample Burial',
                'applicant': 'Test User',
                'submitted': 'May 2026',
                'status': 'Review',
            },
        )

        self.stdout.write(self.style.SUCCESS(
            'Demo data command completed: '
            f'{seeded_user_count} users created, '
            f'{seeded_slot_count} columbarium slots created, '
            f'legacy sample application {"created" if application_created else "already existed"}.'
        ))
