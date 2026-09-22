import torch
from transformers import AutoModel, AutoTokenizer
model_dir='C:\\Users\\admin\\Documents\\BreakTheLoop\\albert-base-v2'
model=AutoModel.from_pretrained(model_dir)
tokenizer=AutoTokenizer.from_pretrained(model_dir)
text='I am feeling anxious and want to watch something online.'
inputs=tokenizer(text, return_tensors='pt')
out=model(**inputs)
print(out.last_hidden_state.shape)
