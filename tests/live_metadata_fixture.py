def cabinet_response():
    cells=[]
    for col,name in enumerate(('A-01','A-02')):
        cell_id=f'fixture:0/0/{col}'
        cells.append(dict(id=cell_id,layer=0,row=0,col=col,name=name,locationId='2' if col==0 else None,
            drawer=dict(id=cell_id,width=12,height=12,revision=0,compartments=[dict(id=cell_id+':whole',x=0,y=0,width=12,height=12)])))
    cabinet=dict(schemaVersion=1,revision=0,layout=dict(schemaVersion=1,id='fixture',name='Fixture cabinet',revision=0,dimensions=dict(layers=1,rows=1,cols=3),cells=cells),
        leafBindings=[dict(compartmentId=cells[0]['drawer']['compartments'][0]['id'],locationId='2')])
    return dict(metadata=dict(smart_inventory=dict(cabinet=cabinet)))
